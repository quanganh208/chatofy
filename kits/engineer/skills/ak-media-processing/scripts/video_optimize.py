#!/usr/bin/env python3
"""
Video size optimization with a verified before/after receipt.

The source is never modified. The encode is staged beside the destination,
fully decoded and compared with the source, and only then moved into place.
An existing destination is never overwritten silently: the default output is a
fresh derived path, and replacing an explicit existing path needs
``--replace-output``, which keeps the previous file as a timestamped backup.

H.264/MP4 stays the default and the compatible fallback. HEVC, VP9 and AV1
profiles are opt-in with codec-specific quality (CRF) and speed settings.
"""

import argparse
import json
import os
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from video_probe import (  # noqa: E402
    SILENCE_DBFS,
    VideoInfo,
    audio_max_volume,
    decode_check,
    even_floor,
    html_type,
    probe_video,
    video_frame_count,
)

__all__ = ["VideoInfo", "VideoOptimizer", "PROFILES", "derive_output_path"]

PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"]
# Codec-specific speed knobs for the shared x264-style preset names.
SVT_AV1_PRESET = dict(zip(PRESETS, ["12", "11", "11", "10", "9", "8", "6", "5", "4"]))
AOM_CPU_USED = dict(zip(PRESETS, ["8", "8", "7", "6", "5", "4", "3", "2", "1"]))
VPX_CPU_USED = dict(zip(PRESETS, ["5", "5", "5", "4", "3", "2", "1", "0", "0"]))
MP4_EXTS = (".mp4", ".m4v", ".mov")
EXIT_REJECTED = 3


@dataclass(frozen=True)
class CodecProfile:
    """One delivery profile. CRF scales differ per encoder, so each has its own default."""

    name: str
    encoders: Tuple[str, ...]
    extensions: Tuple[str, ...]
    default_crf: int
    max_crf: int
    audio_encoder: str
    subtitle_codec: str
    supports_10bit: bool
    supports_alpha: bool
    faststart: bool
    extra: Tuple[str, ...] = field(default_factory=tuple)


PROFILES: Dict[str, CodecProfile] = {
    "h264": CodecProfile("h264", ("libx264",), MP4_EXTS, 23, 51, "aac", "mov_text", False, False, True),
    "hevc": CodecProfile("hevc", ("libx265",), MP4_EXTS, 28, 51, "aac", "mov_text", True, False, True, ("-tag:v", "hvc1")),
    "vp9": CodecProfile("vp9", ("libvpx-vp9",), (".webm",), 33, 63, "libopus", "webvtt", True, True, False, ("-b:v", "0", "-row-mt", "1")),
    "av1": CodecProfile("av1", ("libsvtav1", "libaom-av1"), MP4_EXTS, 35, 63, "aac", "mov_text", True, False, True),
}


def derive_output_path(input_path: Path, extension: str) -> Path:
    """Return a fresh ``<stem>.optimized<ext>`` path beside the input that does not exist yet."""
    base = input_path.with_name(f"{input_path.stem}.optimized{extension}")
    candidate, counter = base, 2
    while candidate.exists():
        candidate = input_path.with_name(f"{input_path.stem}.optimized-{counter}{extension}")
        counter += 1
    return candidate


def backup_path_for(path: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    candidate, counter = path.with_name(f"{path.stem}.bak-{stamp}{path.suffix}"), 2
    while candidate.exists():
        candidate = path.with_name(f"{path.stem}.bak-{stamp}-{counter}{path.suffix}")
        counter += 1
    return candidate


def frame_timing_args() -> Tuple[str, ...]:
    """Keep source frame timing instead of letting the muxer force constant frame rate.

    MP4 output defaults to CFR, which duplicates frames of a variable-rate
    source up to ``r_frame_rate``. ``-fps_mode`` replaced ``-vsync`` in FFmpeg 5.1.
    """
    try:
        result = subprocess.run(["ffmpeg", "-hide_banner", "-h", "long"], capture_output=True, stdin=subprocess.DEVNULL)
        text = result.stdout.decode("utf-8", "replace")
    except Exception:
        text = ""
    return ("-vsync", "vfr") if text and "-fps_mode" not in text else ("-fps_mode", "vfr")


def available_encoders() -> set:
    try:
        result = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, check=True,
                                stdin=subprocess.DEVNULL)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return set()
    names = set()
    for line in result.stdout.decode("utf-8", "replace").splitlines():
        parts = line.split()
        if len(parts) >= 2 and len(parts[0]) == 6 and parts[0][0] in "VAS":
            names.add(parts[1])
    return names


class VideoOptimizer:
    """Handle video optimization operations using FFmpeg."""

    def __init__(self, verbose: bool = False, dry_run: bool = False):
        self.verbose = verbose
        self.dry_run = dry_run
        self.last_receipt: Dict[str, Any] = {}
        self.timing_args: Tuple[str, ...] = ("-fps_mode", "vfr")

    def log(self, message: str) -> None:
        print(message, file=sys.stderr)

    def check_ffmpeg(self) -> bool:
        """Check if FFmpeg and FFprobe are available."""
        try:
            for tool in ("ffmpeg", "ffprobe"):
                subprocess.run([tool, "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True,
                               stdin=subprocess.DEVNULL)
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            return False

    def get_video_info(self, input_path: Path) -> Optional[VideoInfo]:
        """Extract video information using ffprobe; None when it cannot be read."""
        try:
            return probe_video(input_path)
        except Exception as e:  # ffprobe missing, unreadable file, bad JSON
            print(f"Error getting video info: {e}", file=sys.stderr)
            return None

    def calculate_target_resolution(
        self,
        width: int,
        height: int,
        max_width: Optional[int],
        max_height: Optional[int],
    ) -> Tuple[int, int]:
        """Fit within the bounds keeping aspect ratio; never upscale; always even."""
        if width <= 0 or height <= 0:
            raise ValueError("source dimensions are unknown")
        scale = 1.0
        if max_width:
            scale = min(scale, max_width / width)
        if max_height:
            scale = min(scale, max_height / height)
        if scale >= 1.0:
            return even_floor(width), even_floor(height)
        return even_floor(round(width * scale, 6)), even_floor(round(height * scale, 6))

    def _encoder_args(self, profile: CodecProfile, encoder: str, crf: int, preset: str) -> List[str]:
        args = ["-c:v", encoder]
        if encoder in ("libx264", "libx265"):
            args += ["-preset", preset, "-crf", str(crf)]
        elif encoder == "libsvtav1":
            args += ["-preset", SVT_AV1_PRESET[preset], "-crf", str(crf)]
        elif encoder == "libaom-av1":
            args += ["-cpu-used", AOM_CPU_USED[preset], "-row-mt", "1", "-crf", str(crf), "-b:v", "0"]
        elif encoder == "libvpx-vp9":
            args += ["-deadline", "good", "-cpu-used", VPX_CPU_USED[preset], "-crf", str(crf)]
        return args + list(profile.extra)

    def _pix_fmt(self, profile: CodecProfile, info: VideoInfo, warnings: List[str]) -> str:
        if info.has_alpha and profile.supports_alpha:
            return "yuva420p"
        if info.bit_depth > 8:
            if profile.supports_10bit:
                return "yuv420p10le"
            warnings.append(f"{info.bit_depth}-bit source encoded as 8-bit yuv420p for {profile.name} browser compatibility")
        elif info.pix_fmt and info.pix_fmt not in ("yuv420p", "yuvj420p"):
            warnings.append(f"pixel format {info.pix_fmt} converted to yuv420p for browser playback")
        return "yuv420p"

    def build_plan(
        self,
        info: VideoInfo,
        input_path: Path,
        staged_path: Path,
        profile: CodecProfile,
        encoder: str,
        max_width: Optional[int],
        max_height: Optional[int],
        target_fps: Optional[float],
        crf: int,
        audio_bitrate: str,
        preset: str,
        two_pass: bool,
        audio_mode: str,
        subtitle_mode: str,
        allow_format_downgrade: bool,
        passlog: Optional[Path] = None,
    ) -> Dict[str, Any]:
        """Return the commands, expected output and warnings without running anything."""
        warnings: List[str] = []
        errors: List[str] = []
        color_args: List[str] = []
        if info.hdr:
            message = (f"HDR source ({info.color_transfer}) needs a dedicated HDR pipeline; the downgrade is tagged "
                       "BT.709 without tone mapping, so colors look washed out")
            if allow_format_downgrade:
                warnings.append(message)
                color_args = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]
            else:
                errors.append(message + "; pass --allow-format-downgrade to accept it")
        if info.has_alpha and not profile.supports_alpha:
            message = f"source has an alpha channel ({info.pix_fmt}); {profile.name} cannot carry it, use --codec vp9"
            if allow_format_downgrade:
                warnings.append(message + " (alpha flattened by request)")
            else:
                errors.append(message + " or pass --allow-format-downgrade")
        bitmap = [s for s in info.subtitle_streams if s.bitmap]
        if subtitle_mode == "keep" and bitmap:
            errors.append(f"image-based subtitles ({bitmap[0].codec}) cannot become a text track; pass --subtitles drop to drop them")
        if info.other_streams:
            kinds = sorted({s.codec_type or s.codec for s in info.other_streams})
            warnings.append(f"non-media streams not carried over: {', '.join(kinds)}")
        if info.vfr and not target_fps:
            warnings.append("variable frame rate source; frame timing is passed through, no constant rate is forced")

        target_w, target_h = self.calculate_target_resolution(info.display_width, info.display_height, max_width, max_height)
        filters = []
        if (target_w, target_h) != (info.display_width, info.display_height) or info.display_width != info.width and info.rotation in (0, 180):
            filters.append(f"scale={target_w}:{target_h}")
            filters.append("setsar=1")

        fps_args: List[str] = list(self.timing_args)
        expected_fps = info.fps
        if target_fps:
            if info.fps and target_fps >= info.fps:
                warnings.append(f"--fps {target_fps} is not below the source {info.fps:.3f} fps; frame rate kept")
            else:
                fps_args = ["-r", str(target_fps)]
                expected_fps = target_fps

        keep_alpha = info.has_alpha and profile.supports_alpha
        # FFmpeg's native VP8/VP9 decoders drop the WebM alpha channel; libvpx keeps it.
        decoder = {"vp9": "libvpx-vp9", "vp8": "libvpx"}.get(info.codec) if keep_alpha else None
        base = ["ffmpeg", "-hide_banner", "-nostdin"] + (["-c:v", decoder] if decoder else []) + ["-i", str(input_path)]
        video_map = ["-map", f"0:{info.video_index}"]
        maps = list(video_map)
        audio_args: List[str] = []
        if audio_mode == "drop" or not info.has_audio:
            audio_args = ["-an"]
        else:
            maps += ["-map", "0:a?"]
            if audio_mode == "copy":
                audio_args = ["-c:a", "copy"]
            else:
                audio_args = ["-c:a", profile.audio_encoder, "-b:a", audio_bitrate]
        subtitle_args: List[str] = ["-sn"]
        kept_subtitles = 0
        if subtitle_mode == "keep" and info.subtitle_streams and not bitmap:
            maps += ["-map", "0:s?"]
            subtitle_args = ["-c:s", profile.subtitle_codec]
            kept_subtitles = len(info.subtitle_streams)

        vf = ["-vf", ",".join(filters)] if filters else []
        pix = ["-pix_fmt", self._pix_fmt(profile, info, warnings)]
        commands: List[List[str]] = []
        if two_pass:
            if profile.name != "h264":
                errors.append("--two-pass is supported for the h264 profile only")
            target_bitrate = int(info.bitrate * 0.7)
            if target_bitrate <= 0:
                errors.append("--two-pass needs the source bitrate, which ffprobe did not report")
            log_args = ["-passlogfile", str(passlog)] if passlog else []
            video = ["-c:v", encoder, "-preset", preset, "-b:v", str(target_bitrate)]
            null = "NUL" if sys.platform == "win32" else "/dev/null"
            commands.append(base + video_map + vf + fps_args + pix + video + ["-pass", "1"] + log_args + ["-an", "-sn", "-y", "-f", "null", null])
            video_args = video + ["-pass", "2"] + log_args
        else:
            video_args = self._encoder_args(profile, encoder, crf, preset)
        final = base + maps + vf + fps_args + pix + video_args + color_args + audio_args + subtitle_args + ["-map_metadata", "0"]
        if info.has_alpha and not keep_alpha:
            final += ["-metadata:s:v:0", "alpha_mode="]  # do not claim an alpha channel that was flattened
        if profile.faststart:
            final += ["-movflags", "+faststart"]
        # Staged path is fresh, so -n refuses rather than overwrites if it somehow exists.
        final += ["-n", str(staged_path)]
        commands.append(final)

        return {
            "commands": commands,
            "errors": errors,
            "warnings": warnings,
            "expected": {
                "width": target_w,
                "height": target_h,
                "fps": expected_fps,
                "audio_streams": 0 if audio_args == ["-an"] else len(info.audio_streams),
                "subtitle_streams": kept_subtitles,
                "alpha": keep_alpha,
                "same_frames": fps_args[0] != "-r",
            },
        }

    def verify_output(self, source: VideoInfo, output: Optional[VideoInfo], expected: Dict[str, Any], staged: Path) -> List[str]:
        """Return failed checks; an empty list means the output may be promoted."""
        if output is None:
            return ["output could not be probed or has no video stream"]
        failures = []
        decode_error = decode_check(staged)
        if decode_error:
            failures.append(f"output does not decode cleanly: {decode_error}")
        if (output.display_width, output.display_height) != (expected["width"], expected["height"]):
            failures.append(f"output is {output.display_width}x{output.display_height}, expected {expected['width']}x{expected['height']}")
        # Video stream duration: a dropped audio track may legitimately run longer than the picture.
        src_duration, out_duration = source.video_duration, output.video_duration
        if src_duration > 0:
            drift = abs(out_duration - src_duration)
            if drift > max(0.5, src_duration * 0.02):
                failures.append(f"duration changed by {drift:.2f}s ({src_duration:.2f}s -> {out_duration:.2f}s)")
        if expected.get("same_frames"):
            src_frames = video_frame_count(source.path, str(source.video_index))
            out_frames = video_frame_count(staged)
            if src_frames and out_frames is not None and abs(out_frames - src_frames) > max(2, src_frames * 0.02):
                failures.append(f"frame count changed from {src_frames} to {out_frames}")
        if output.has_alpha != expected.get("alpha", output.has_alpha):
            failures.append("alpha channel " + ("lost" if expected.get("alpha") else "unexpectedly present"))
        if len(output.audio_streams) != expected["audio_streams"]:
            failures.append(f"output has {len(output.audio_streams)} audio stream(s), expected {expected['audio_streams']}")
        if len(output.subtitle_streams) != expected["subtitle_streams"]:
            failures.append(f"output has {len(output.subtitle_streams)} subtitle stream(s), expected {expected['subtitle_streams']}")
        return failures

    def optimize_video(
        self,
        input_path: Path,
        output_path: Optional[Path] = None,
        max_width: Optional[int] = None,
        max_height: Optional[int] = None,
        target_fps: Optional[float] = None,
        crf: Optional[int] = None,
        audio_bitrate: str = "128k",
        preset: str = "medium",
        two_pass: bool = False,
        codec: str = "h264",
        encoder: Optional[str] = None,
        audio_mode: str = "encode",
        drop_silent_audio: bool = False,
        subtitle_mode: str = "keep",
        replace_output: bool = False,
        keep_larger: bool = False,
        allow_format_downgrade: bool = False,
    ) -> bool:
        """Optimize a video; the outcome is in ``self.last_receipt``."""
        profile = PROFILES[codec]
        encoder = encoder or profile.encoders[0]
        crf = profile.default_crf if crf is None else crf
        receipt: Dict[str, Any] = {"status": "failed", "source": str(input_path), "codec_profile": codec,
                                   "encoder": encoder, "warnings": [], "checks": []}
        self.last_receipt = receipt

        def fail(message: str) -> bool:
            receipt["error"] = message
            print(f"Error: {message}", file=sys.stderr)
            return False

        if not 0 <= crf <= profile.max_crf:
            return fail(f"--crf {crf} is outside 0-{profile.max_crf} for {codec}")
        info = self.get_video_info(input_path)
        if not info:
            return fail(f"Could not read video info for {input_path}")
        receipt["source_info"] = info.summary()

        if output_path is None:
            output_path = derive_output_path(input_path, profile.extensions[0])
        elif output_path.suffix.lower() not in profile.extensions:
            return fail(f"{output_path.suffix or 'no extension'} does not fit the {codec} profile; use {', '.join(profile.extensions)}")
        receipt["output"] = str(output_path)
        if output_path.exists() and input_path.exists() and os.path.samefile(output_path, input_path):
            return fail("output path is the source file; the source is never overwritten")
        if output_path.exists() and not replace_output:
            return fail(f"{output_path} already exists; choose another path, omit -o for a fresh one, or pass --replace-output")

        if info.has_audio and audio_mode != "drop" and drop_silent_audio:
            if self.dry_run:
                receipt["warnings"].append("silence check skipped in dry-run; audio kept in the plan")
            else:
                peaks = [audio_max_volume(input_path, stream=i) for i in range(max(1, len(info.audio_streams)))]
                receipt["audio_peaks_dbfs"] = peaks
                if all(p is not None and p <= SILENCE_DBFS for p in peaks):
                    audio_mode = "drop"
                    receipt["warnings"].append(f"audio dropped: every track peaks at or below {SILENCE_DBFS} dBFS")
                else:
                    receipt["warnings"].append("audio kept: a track is audible or could not be measured")

        staged = output_path.with_name(f".{output_path.stem}.partial-{os.getpid()}{output_path.suffix}")
        passdir = Path(tempfile.mkdtemp(prefix="ak-video-2pass-")) if two_pass and not self.dry_run else None
        try:
            try:
                plan = self.build_plan(info, input_path, staged, profile, encoder, max_width, max_height, target_fps,
                                       crf, audio_bitrate, preset, two_pass, audio_mode, subtitle_mode,
                                       allow_format_downgrade, passlog=(passdir / "pass") if passdir else None)
            except ValueError as exc:
                return fail(str(exc))
            receipt["warnings"] += plan["warnings"]
            receipt["expected"] = plan["expected"]
            receipt["commands"] = [shlex.join(c) for c in plan["commands"]]
            if plan["errors"]:
                return fail("; ".join(plan["errors"]))

            if self.verbose or self.dry_run:
                for command in receipt["commands"]:
                    self.log(f"Command: {command}")
            if self.dry_run:
                receipt["status"] = "dry-run"
                return True

            started = time.monotonic()
            try:
                for command in plan["commands"]:
                    # On any exception, including SIGTERM raised as SystemExit, run() kills FFmpeg.
                    subprocess.run(command, check=True, capture_output=not self.verbose, stdin=subprocess.DEVNULL)
            except Exception as exc:
                return fail(f"encoding failed: {exc}")
            receipt["encode_seconds"] = round(time.monotonic() - started, 3)

            out_info = self.get_video_info(staged) if staged.exists() else None
            failures = self.verify_output(info, out_info, plan["expected"], staged)
            receipt["checks"] = failures or ["decode, dimensions, duration and track counts verified"]
            if out_info:
                receipt["output_info"] = out_info.summary()
                receipt["html_type"] = html_type(out_info)
                out_bytes = staged.stat().st_size
                receipt["bytes"] = {"source": input_path.stat().st_size, "output": out_bytes}
                receipt["savings_pct"] = round((1 - out_bytes / receipt["bytes"]["source"]) * 100, 2) if receipt["bytes"]["source"] else None
            if failures:
                receipt["status"] = "rejected"
                return fail("output failed verification: " + "; ".join(failures))
            if replace_output and output_path.exists():
                receipt["bytes"]["replaced"] = output_path.stat().st_size
            if receipt["bytes"]["output"] >= receipt["bytes"]["source"] and not keep_larger:
                receipt["status"] = "rejected"
                return fail("output is not smaller than the source; nothing was written (pass --keep-larger to keep it)")
            if "replaced" in receipt["bytes"]:
                # The file being replaced may already be an optimized asset; replacing it
                # with something larger would raise the bytes every viewer downloads.
                if receipt["bytes"]["output"] >= receipt["bytes"]["replaced"] and not keep_larger:
                    receipt["status"] = "rejected"
                    return fail(f"output is not smaller than the existing {output_path.name}; "
                                "nothing was replaced (pass --keep-larger to replace it anyway)")

            if output_path.exists() and not replace_output:
                return fail(f"{output_path} appeared during the encode; nothing was replaced")
            backup = None
            try:
                if output_path.exists():
                    backup = backup_path_for(output_path)
                    os.replace(output_path, backup)
                os.replace(staged, output_path)
            except OSError as exc:
                if backup and not output_path.exists():
                    try:
                        os.replace(backup, output_path)
                        backup = None
                    except OSError:
                        pass
                if backup:
                    receipt["replaced_backup"] = str(backup)
                return fail(f"could not move the verified output into place: {exc}")
            if backup:
                receipt["replaced_backup"] = str(backup)
            receipt["status"] = "ok"
            return True
        finally:
            staged.unlink(missing_ok=True)
            if passdir:
                shutil.rmtree(passdir, ignore_errors=True)

    def compare_videos(self, original: Path, optimized: Path) -> None:
        """Compare original and optimized videos."""
        orig_info = self.get_video_info(original)
        opt_info = self.get_video_info(optimized)

        if not orig_info or not opt_info:
            print("Error: Could not compare videos", file=sys.stderr)
            return

        def pct(new: float, old: float) -> str:
            return f"{((new / old) - 1) * 100:+.1f}%" if old else "n/a"

        print(f"\n{'Metric':<20} {'Original':<20} {'Optimized':<20} {'Change':<15}")
        print("-" * 75)
        print(f"{'Resolution':<20} {orig_info.display_width}x{orig_info.display_height:<15} "
              f"{opt_info.display_width}x{opt_info.display_height:<15}")
        print(f"{'FPS':<20} {orig_info.fps:<20.2f} {opt_info.fps:<20.2f} {opt_info.fps - orig_info.fps:+.2f}")
        print(f"{'Codec':<20} {orig_info.codec:<20} {opt_info.codec:<20}")
        print(f"{'Bitrate':<20} {f'{orig_info.bitrate // 1000} kbps':<20} {f'{opt_info.bitrate // 1000} kbps':<20} "
              f"{pct(opt_info.bitrate, orig_info.bitrate)}")
        print(f"{'Size':<20} {f'{orig_info.size / (1024*1024):.2f} MB':<20} {f'{opt_info.size / (1024*1024):.2f} MB':<20} "
              f"{pct(opt_info.size, orig_info.size)}")


def print_receipt(receipt: Dict[str, Any]) -> None:
    print(f"Status: {receipt['status']}")
    if receipt.get("output"):
        print(f"Output: {receipt['output']}")
    if receipt.get("bytes"):
        b = receipt["bytes"]
        print(f"Bytes: {b['source']} -> {b['output']} ({receipt.get('savings_pct')}% saved)")
        if "replaced" in b:
            print(f"Replaced output bytes: {b['replaced']}")
    if receipt.get("output_info"):
        o = receipt["output_info"]
        print(f"Output stream: {o['codec']} {o['display_width']}x{o['display_height']} @ {o['fps']:.3f} fps, "
              f"{o['pix_fmt']}, audio {len(o['audio_streams'])}, subtitles {len(o['subtitle_streams'])}")
    if receipt.get("html_type"):
        print(f"HTML: <source src=\"{Path(receipt['output']).name}\" type='{receipt['html_type']}'>")
    if "encode_seconds" in receipt:
        print(f"Encode time: {receipt['encode_seconds']}s")
    for check in receipt.get("checks", []):
        print(f"Check: {check}")
    for warning in receipt.get("warnings", []):
        print(f"Warning: {warning}")
    if receipt.get("replaced_backup"):
        print(f"Previous output kept at: {receipt['replaced_backup']}")
    for command in receipt.get("commands", []):
        print(f"Command: {command}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Video size optimization with a verified before/after receipt.")
    parser.add_argument("input", type=Path, help="Input video file (never modified)")
    parser.add_argument("-o", "--output", type=Path,
                        help="Output file; defaults to a fresh <name>.optimized.<ext> beside the input")
    parser.add_argument("-w", "--max-width", type=int, help="Maximum display width in pixels (never upscales)")
    parser.add_argument("-H", "--max-height", type=int, help="Maximum display height in pixels (never upscales)")
    parser.add_argument("--fps", type=float, help="Lower the frame rate to this value (never raises it)")
    parser.add_argument("--codec", choices=sorted(PROFILES), default="h264",
                        help="Delivery profile (default: h264, the compatible fallback)")
    parser.add_argument("--encoder", help="Pick one of the profile's encoders, e.g. libaom-av1 for av1")
    parser.add_argument("--crf", type=int, help="Quality, lower is better; default depends on the codec (h264 23, hevc 28, vp9 33, av1 35)")
    parser.add_argument("--audio", choices=["encode", "copy", "drop"], default="encode",
                        help="Audio handling (default: encode every audio track)")
    parser.add_argument("--drop-silent-audio", action="store_true",
                        help=f"Drop audio only when its measured peak is at or below {SILENCE_DBFS} dBFS")
    parser.add_argument("--audio-bitrate", default="128k", help="Audio bitrate when encoding (default: 128k)")
    parser.add_argument("--subtitles", choices=["keep", "drop"], default="keep",
                        help="Subtitle handling (default: keep text tracks)")
    parser.add_argument("--preset", choices=PRESETS, default="medium", help="Speed/compression preset (default: medium)")
    parser.add_argument("--two-pass", action="store_true", help="Two-pass bitrate encoding (h264 only)")
    parser.add_argument("--replace-output", action="store_true",
                        help="Replace an existing output after verification, keeping it as a .bak-<time> backup; "
                             "the new file must also be smaller than the one it replaces")
    parser.add_argument("--keep-larger", action="store_true", help="Keep the output even when it is not smaller than the source or the replaced file")
    parser.add_argument("--allow-format-downgrade", action="store_true",
                        help="Accept losing HDR or alpha when the profile cannot carry it")
    parser.add_argument("--compare", action="store_true", help="Print an original/optimized comparison table")
    parser.add_argument("--json", action="store_true", help="Print the receipt as JSON on stdout")
    parser.add_argument("-n", "--dry-run", action="store_true", help="Show the plan and commands without writing anything")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")
    return parser


def _exit_on_sigterm(signum, _frame):
    # SystemExit unwinds through run() (which kills FFmpeg) and the staged-file cleanup.
    raise SystemExit(128 + signum)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _exit_on_sigterm)
    if not args.input.is_file():
        print(f"Error: Input file not found: {args.input}", file=sys.stderr)
        return 1

    optimizer = VideoOptimizer(verbose=args.verbose, dry_run=args.dry_run)
    if not optimizer.check_ffmpeg():
        print("Error: FFmpeg/FFprobe not found; install ffmpeg (brew install ffmpeg / apt-get install ffmpeg)", file=sys.stderr)
        return 1
    profile = PROFILES[args.codec]
    if args.encoder and args.encoder not in profile.encoders:
        print(f"Error: --encoder {args.encoder} is not part of the {args.codec} profile; use {', '.join(profile.encoders)}",
              file=sys.stderr)
        return 1
    optimizer.timing_args = frame_timing_args()
    encoders = available_encoders()
    encoder = args.encoder or next((e for e in profile.encoders if e in encoders), None)
    if not encoder or encoder not in encoders:
        wanted = args.encoder or " or ".join(profile.encoders)
        print(f"Error: this FFmpeg build has no {wanted} encoder for the {args.codec} profile", file=sys.stderr)
        return 1

    print(f"Optimizing {args.input.name}...", file=sys.stderr)
    ok = optimizer.optimize_video(
        args.input, args.output, args.max_width, args.max_height, args.fps, args.crf, args.audio_bitrate,
        args.preset, args.two_pass, codec=args.codec, encoder=encoder, audio_mode=args.audio,
        drop_silent_audio=args.drop_silent_audio, subtitle_mode=args.subtitles, replace_output=args.replace_output,
        keep_larger=args.keep_larger, allow_format_downgrade=args.allow_format_downgrade,
    )
    receipt = optimizer.last_receipt
    if args.json:
        print(json.dumps(receipt, indent=2, default=str))
    else:
        print_receipt(receipt)
    if ok and args.compare and not args.dry_run:
        optimizer.compare_videos(args.input, Path(receipt["output"]))
    if ok:
        return 0
    return EXIT_REJECTED if receipt.get("status") == "rejected" else 1


if __name__ == "__main__":
    sys.exit(main())
