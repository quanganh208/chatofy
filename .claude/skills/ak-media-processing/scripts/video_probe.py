#!/usr/bin/env python3
"""Read-only FFprobe helpers shared by the video optimizer and the web audit.

Everything here inspects files; nothing writes. Missing or zero metadata is
reported as ``None``/``0`` rather than guessed, so callers can say what they
could not measure.
"""

import json
import re
import shutil
import subprocess
from dataclasses import asdict, dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Any, Dict, List, Optional

HDR_TRANSFERS = {"smpte2084", "arib-std-b67"}
# Image-based subtitle codecs cannot be converted to a text track.
BITMAP_SUBTITLE_CODECS = {"hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "xsub"}
# Variable frame rate is assumed when real and average rates differ by more than this.
VFR_TOLERANCE = 0.01


def parse_rational(value: Any) -> Optional[Fraction]:
    """Parse ``"30000/1001"``, ``"25"`` or ``25.0`` into a positive Fraction.

    Returns None for missing, zero, negative or malformed values (ffprobe
    reports ``0/0`` when it cannot tell).
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        if "/" in text:
            num, den = text.split("/", 1)
            if int(den) == 0:
                return None
            frac = Fraction(int(num), int(den))
        else:
            frac = Fraction(text).limit_denominator(1000000)
    except (ValueError, ZeroDivisionError):
        return None
    return frac if frac > 0 else None


def _int(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def even_floor(value: float) -> int:
    """Largest even integer <= value, never below 2."""
    return max(2, int(value) - (int(value) % 2))


def stream_rotation(stream: Dict[str, Any]) -> int:
    """Return the clockwise display rotation in degrees (0, 90, 180, 270)."""
    rotation = None
    for side in stream.get("side_data_list") or []:
        if "rotation" in side:
            rotation = side.get("rotation")
            break
    if rotation is None:
        rotation = (stream.get("tags") or {}).get("rotate")
    try:
        degrees = int(round(float(rotation))) if rotation is not None else 0
    except (TypeError, ValueError):
        degrees = 0
    return degrees % 360


def pixel_bit_depth(pix_fmt: str) -> int:
    match = re.search(r"p(\d{2})(le|be)$", pix_fmt or "")
    return int(match.group(1)) if match else 8


def pixel_has_alpha(pix_fmt: str) -> bool:
    fmt = pix_fmt or ""
    return fmt.startswith(("yuva", "rgba", "bgra", "argb", "abgr", "gbrap", "ya")) or fmt in {"pal8"}


@dataclass
class StreamSummary:
    index: int
    codec_type: str
    codec: str
    language: str = ""
    channels: int = 0
    bitrate: int = 0
    bitmap: bool = False


@dataclass
class VideoInfo:
    """Video file information.

    ``width``/``height`` are the coded frame size. ``display_width`` and
    ``display_height`` apply rotation and sample aspect ratio, which is what a
    viewer sees and what FFmpeg's auto-rotation feeds to filters.
    """

    path: Path
    duration: float
    width: int
    height: int
    bitrate: int
    fps: float
    size: int
    codec: str
    audio_codec: str
    audio_bitrate: int
    display_width: int = 0
    display_height: int = 0
    rotation: int = 0
    fps_rational: str = ""
    vfr: bool = False
    pix_fmt: str = ""
    bit_depth: int = 8
    has_alpha: bool = False
    hdr: bool = False
    color_transfer: str = ""
    profile: str = ""
    level: int = 0
    container: str = ""
    video_index: int = 0
    video_duration: float = 0.0
    audio_streams: List[StreamSummary] = field(default_factory=list)
    subtitle_streams: List[StreamSummary] = field(default_factory=list)
    other_streams: List[StreamSummary] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.display_width:
            self.display_width = self.width
        if not self.display_height:
            self.display_height = self.height
        if not self.video_duration:
            self.video_duration = self.duration

    @property
    def has_audio(self) -> bool:
        return bool(self.audio_streams) or self.audio_codec not in ("", "none")

    def summary(self) -> Dict[str, Any]:
        data = asdict(self)
        data["path"] = str(self.path)
        data["has_audio"] = self.has_audio
        return data


def ffprobe_available() -> bool:
    return shutil.which("ffprobe") is not None


def run_ffprobe(path: Path) -> Dict[str, Any]:
    cmd = [
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, check=True, stdin=subprocess.DEVNULL)
    return json.loads(result.stdout)


def _summary(stream: Dict[str, Any]) -> StreamSummary:
    codec = stream.get("codec_name", "unknown")
    return StreamSummary(
        index=_int(stream.get("index")),
        codec_type=stream.get("codec_type", ""),
        codec=codec,
        language=(stream.get("tags") or {}).get("language", ""),
        channels=_int(stream.get("channels")),
        bitrate=_int(stream.get("bit_rate")),
        bitmap=codec in BITMAP_SUBTITLE_CODECS,
    )


def parse_probe(path: Path, data: Dict[str, Any], file_size: Optional[int] = None) -> Optional[VideoInfo]:
    """Build VideoInfo from ffprobe JSON; None when there is no video stream."""
    streams = data.get("streams") or []
    fmt = data.get("format") or {}
    video = None
    audio: List[StreamSummary] = []
    subtitles: List[StreamSummary] = []
    other: List[StreamSummary] = []
    first_audio: Optional[Dict[str, Any]] = None
    for stream in streams:
        kind = stream.get("codec_type")
        disposition = stream.get("disposition") or {}
        if kind == "video" and video is None and not disposition.get("attached_pic"):
            video = stream
        elif kind == "audio":
            audio.append(_summary(stream))
            first_audio = first_audio or stream
        elif kind == "subtitle":
            subtitles.append(_summary(stream))
        elif kind != "video":
            other.append(_summary(stream))
    if video is None:
        return None

    width = _int(video.get("width"))
    height = _int(video.get("height"))
    rotation = stream_rotation(video)
    sar = parse_rational((video.get("sample_aspect_ratio") or "").replace(":", "/")) or Fraction(1)
    display_w = int(round(width * sar)) if width else 0
    display_h = height
    if rotation in (90, 270):
        display_w, display_h = display_h, display_w

    avg = parse_rational(video.get("avg_frame_rate"))
    real = parse_rational(video.get("r_frame_rate"))
    rate = avg or real
    vfr = bool(avg and real and abs(float(avg) - float(real)) / float(real) > VFR_TOLERANCE)

    duration = _float(fmt.get("duration")) or _float(video.get("duration"))
    size = _int(fmt.get("size")) or (file_size or 0)
    bitrate = _int(fmt.get("bit_rate"))
    if not bitrate and size and duration:
        bitrate = int(size * 8 / duration)
    pix_fmt = video.get("pix_fmt", "") or ""
    # VP8/VP9 WebM keeps alpha in a side channel: pix_fmt reads yuv420p and only the tag tells.
    tags = {str(k).lower(): str(v) for k, v in (video.get("tags") or {}).items()}
    alpha = pixel_has_alpha(pix_fmt) or tags.get("alpha_mode") == "1"
    transfer = video.get("color_transfer", "") or ""

    return VideoInfo(
        path=path,
        duration=duration,
        width=width,
        height=height,
        bitrate=bitrate,
        fps=float(rate) if rate else 0.0,
        size=size,
        codec=video.get("codec_name", "unknown"),
        audio_codec=first_audio.get("codec_name", "unknown") if first_audio else "none",
        audio_bitrate=_int(first_audio.get("bit_rate")) if first_audio else 0,
        display_width=display_w,
        display_height=display_h,
        rotation=rotation,
        fps_rational=f"{rate.numerator}/{rate.denominator}" if rate else "",
        vfr=vfr,
        pix_fmt=pix_fmt,
        bit_depth=pixel_bit_depth(pix_fmt),
        has_alpha=alpha,
        hdr=transfer in HDR_TRANSFERS,
        color_transfer=transfer,
        profile=video.get("profile", "") or "",
        level=_int(video.get("level")),
        container=fmt.get("format_name", "") or "",
        video_index=_int(video.get("index")),
        video_duration=_float(video.get("duration")) or duration,
        audio_streams=audio,
        subtitle_streams=subtitles,
        other_streams=other,
    )


def probe_video(path: Path) -> Optional[VideoInfo]:
    """Probe ``path``; None when ffprobe fails or finds no video stream."""
    data = run_ffprobe(path)
    size = path.stat().st_size if path.exists() else None
    return parse_probe(path, data, size)


def decode_check(path: Path, timeout: Optional[float] = None) -> Optional[str]:
    """Fully decode ``path``; return None when clean, else the first error text."""
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(path), "-map", "0:v:0", "-map", "0:a?", "-f", "null", "-"]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return "decode check timed out"
    except OSError as exc:
        return f"decode check could not run: {exc}"
    stderr = (result.stderr or b"").decode("utf-8", "replace").strip()
    if result.returncode != 0:
        return stderr.splitlines()[0] if stderr else f"ffmpeg exited {result.returncode}"
    return None


def audio_max_volume(path: Path, timeout: Optional[float] = None, stream: int = 0) -> Optional[float]:
    """Return the peak in dBFS of audio stream ``stream`` (0-based), or None when not measurable."""
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-i", str(path), "-map", f"0:a:{stream}",
           "-af", "volumedetect", "-f", "null", "-"]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL)
    except (subprocess.TimeoutExpired, OSError):
        return None
    match = re.search(r"max_volume:\s*(-?inf|-?[\d.]+) dB", (result.stderr or b"").decode("utf-8", "replace"))
    if not match:
        return None
    value = match.group(1)
    return float("-inf") if "inf" in value else float(value)


SILENCE_DBFS = -60.0


def video_frame_count(path: Path, stream: str = "v:0", timeout: Optional[float] = None) -> Optional[int]:
    """Count the packets of one video stream by demuxing only; None when not measurable."""
    cmd = ["ffprobe", "-v", "error", "-select_streams", stream, "-count_packets",
           "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", str(path)]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL)
    except (subprocess.TimeoutExpired, OSError):
        return None
    text = (result.stdout or b"").decode("utf-8", "replace").strip().splitlines()
    try:
        return int(text[0].strip().rstrip(",")) if result.returncode == 0 and text else None
    except ValueError:
        return None


def _avc_codecs(info: VideoInfo) -> str:
    profiles = {
        "constrained baseline": "42E0", "baseline": "4200", "main": "4D40",
        "extended": "5800", "high": "6400", "high 10": "6E00",
        "high 4:2:2": "7A00", "high 4:4:4 predictive": "F400",
    }
    prefix = profiles.get(info.profile.lower(), "6400")
    level = info.level if info.level > 0 else 40
    return f"avc1.{prefix}{level:02X}"


def _hevc_codecs(info: VideoInfo) -> str:
    main10 = "10" in info.profile or info.bit_depth > 8
    level = info.level if info.level > 0 else 120
    return f"hvc1.{2 if main10 else 1}.{4 if main10 else 6}.L{level}.B0"


def _av1_codecs(info: VideoInfo) -> str:
    profile = {"main": 0, "high": 1, "professional": 2}.get(info.profile.lower(), 0)
    level = info.level if 0 <= info.level < 32 else 8
    return f"av01.{profile}.{level:02d}M.{info.bit_depth:02d}"


AUDIO_CODECS_STRINGS = {"aac": "mp4a.40.2", "opus": "opus", "vorbis": "vorbis", "mp3": "mp4a.40.34"}


MP4_VIDEO_CODECS = {"h264": _avc_codecs, "hevc": _hevc_codecs, "av1": _av1_codecs}
WEBM_VIDEO_CODECS = {"vp8", "vp9", "av1"}


def html_type(info: VideoInfo) -> Optional[str]:
    """Return an HTML ``<source type>`` value, or None for a container browsers do not play.

    The codecs parameter is included only when every track maps to a known
    codecs string; otherwise only the MIME type is returned.
    """
    container = set(info.container.split(","))
    if container & {"mp4", "mov"}:
        mime, video = "video/mp4", MP4_VIDEO_CODECS[info.codec](info) if info.codec in MP4_VIDEO_CODECS else None
    elif "webm" in container and info.codec in WEBM_VIDEO_CODECS:
        mime, video = "video/webm", _av1_codecs(info) if info.codec == "av1" else info.codec
    else:
        return None
    codecs = [video]
    if info.audio_streams:
        codecs.append(AUDIO_CODECS_STRINGS.get(info.audio_streams[0].codec))
    if not all(codecs):
        return mime
    return f'{mime}; codecs="{", ".join(codecs)}"'
