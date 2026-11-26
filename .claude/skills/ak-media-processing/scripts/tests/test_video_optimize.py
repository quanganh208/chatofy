#!/usr/bin/env python3
"""Tests for video_optimize.py and video_probe.py.

Unit tests mock FFmpeg. Integration tests generate tiny fixtures with FFmpeg's
lavfi sources and are skipped when ffmpeg/ffprobe are not installed.
"""

import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import video_optimize  # noqa: E402
from video_optimize import PROFILES, VideoInfo, VideoOptimizer, derive_output_path, main  # noqa: E402
from video_probe import StreamSummary, html_type, parse_probe, parse_rational, video_frame_count  # noqa: E402

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
needs_ffmpeg = pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg/ffprobe not installed")


def make_info(**overrides) -> VideoInfo:
    base = dict(path=Path("input.mp4"), duration=120.0, width=1920, height=1080, bitrate=5000000, fps=30.0,
                size=75000000, codec="h264", audio_codec="aac", audio_bitrate=128000,
                audio_streams=[StreamSummary(1, "audio", "aac")])
    base.update(overrides)
    return VideoInfo(**base)


def fake_encoder(output_bytes: int = 1000, output_info: VideoInfo = None):
    """subprocess.run stand-in that writes the staged output named last in the command."""

    def run(cmd, **kwargs):
        if cmd[0] == "ffmpeg" and "-f" not in cmd:
            Path(cmd[-1]).write_bytes(b"x" * output_bytes)
        return MagicMock(returncode=0, stdout=b"", stderr=b"")

    return run


class TestProbeParsing:
    def test_parse_rational_rejects_zero_and_garbage(self):
        assert parse_rational("0/0") is None
        assert parse_rational("30/0") is None
        assert parse_rational("abc") is None
        assert parse_rational(None) is None
        assert float(parse_rational("30000/1001")) == pytest.approx(29.97, rel=1e-3)
        assert float(parse_rational("25")) == 25.0

    def test_avg_frame_rate_preferred_and_vfr_detected(self):
        data = {"streams": [{"codec_type": "video", "codec_name": "h264", "width": 320, "height": 240,
                             "r_frame_rate": "30/1", "avg_frame_rate": "200/9"}], "format": {"duration": "2"}}
        info = parse_probe(Path("v.mp4"), data, file_size=1000)
        assert info.fps == pytest.approx(22.22, rel=1e-3)
        assert info.vfr is True
        assert info.size == 1000
        assert info.bitrate == 4000  # derived from size/duration when format bit_rate is missing

    def test_missing_frame_rate_falls_back_to_zero(self):
        data = {"streams": [{"codec_type": "video", "codec_name": "h264", "width": 320, "height": 240,
                             "r_frame_rate": "0/0", "avg_frame_rate": "0/0"}], "format": {}}
        info = parse_probe(Path("v.mp4"), data)
        assert info.fps == 0.0 and info.fps_rational == "" and info.vfr is False

    def test_rotation_swaps_display_dimensions(self):
        data = {"streams": [{"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080,
                             "side_data_list": [{"rotation": -90}]}], "format": {}}
        info = parse_probe(Path("v.mp4"), data)
        assert (info.display_width, info.display_height, info.rotation) == (1080, 1920, 270)

    def test_sample_aspect_ratio_applied(self):
        data = {"streams": [{"codec_type": "video", "codec_name": "h264", "width": 720, "height": 576,
                             "sample_aspect_ratio": "16:15"}], "format": {}}
        assert parse_probe(Path("v.mp4"), data).display_width == 768

    def test_hdr_alpha_bitdepth_and_tracks(self):
        data = {"streams": [
            {"index": 0, "codec_type": "video", "codec_name": "hevc", "width": 3840, "height": 2160,
             "pix_fmt": "yuv420p10le", "color_transfer": "smpte2084"},
            {"index": 1, "codec_type": "audio", "codec_name": "eac3", "channels": 6},
            {"index": 2, "codec_type": "subtitle", "codec_name": "hdmv_pgs_subtitle"},
            {"index": 3, "codec_type": "data", "codec_name": "bin_data"},
        ], "format": {}}
        info = parse_probe(Path("v.mkv"), data)
        assert info.hdr and info.bit_depth == 10 and not info.has_alpha
        assert info.subtitle_streams[0].bitmap is True
        assert [s.codec_type for s in info.other_streams] == ["data"]

    def test_attached_picture_is_not_the_video_stream(self):
        data = {"streams": [
            {"codec_type": "video", "codec_name": "mjpeg", "width": 600, "height": 600, "disposition": {"attached_pic": 1}},
            {"codec_type": "video", "codec_name": "h264", "width": 1280, "height": 720},
        ], "format": {}}
        assert parse_probe(Path("v.mp4"), data).codec == "h264"

    def test_html_type_codecs_strings(self):
        avc = make_info(profile="High", level=40, container="mov,mp4,m4a,3gp,3g2,mj2")
        assert html_type(avc) == 'video/mp4; codecs="avc1.640028, mp4a.40.2"'
        vp9 = make_info(codec="vp9", container="matroska,webm", audio_streams=[StreamSummary(1, "audio", "opus")])
        assert html_type(vp9) == 'video/webm; codecs="vp9, opus"'
        hevc = make_info(codec="hevc", profile="Main", level=120, container="mov,mp4", audio_streams=[])
        assert html_type(hevc) == 'video/mp4; codecs="hvc1.1.6.L120.B0"'

    def test_html_type_never_invents_a_type(self):
        assert html_type(make_info(container="matroska,webm")) is None  # H.264 in MKV is not a web source
        odd = make_info(codec="mpeg4", container="mov,mp4,m4a,3gp,3g2,mj2")
        assert html_type(odd) == "video/mp4"

    def test_webm_alpha_mode_tag_means_alpha(self):
        data = {"streams": [{"index": 0, "codec_type": "video", "codec_name": "vp9", "width": 64, "height": 64,
                             "pix_fmt": "yuv420p", "tags": {"ALPHA_MODE": "1", "DURATION": "00:00:01"}}],
                "format": {"format_name": "matroska,webm"}}
        assert parse_probe(Path("a.webm"), data).has_alpha is True

    def test_video_stream_duration_and_index(self):
        data = {"streams": [{"index": 0, "codec_type": "audio", "codec_name": "aac", "duration": "5.0"},
                            {"index": 1, "codec_type": "video", "codec_name": "h264", "width": 2, "height": 2,
                             "duration": "4.0"}], "format": {"duration": "5.0"}}
        info = parse_probe(Path("v.mp4"), data)
        assert (info.video_index, info.video_duration, info.duration) == (1, 4.0, 5.0)


class TestVideoOptimizer:
    def setup_method(self):
        self.optimizer = VideoOptimizer(verbose=False, dry_run=False)

    @patch("subprocess.run")
    def test_check_ffmpeg_available(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        assert self.optimizer.check_ffmpeg() is True

    @patch("subprocess.run")
    def test_check_ffmpeg_unavailable(self, mock_run):
        mock_run.side_effect = FileNotFoundError()
        assert self.optimizer.check_ffmpeg() is False

    @patch("subprocess.run")
    def test_get_video_info_success(self, mock_run):
        mock_data = {
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080, "r_frame_rate": "30/1"},
                {"codec_type": "audio", "codec_name": "aac", "bit_rate": "128000"},
            ],
            "format": {"duration": "120.5", "bit_rate": "5000000", "size": "75000000"},
        }
        mock_run.return_value = MagicMock(stdout=json.dumps(mock_data).encode(), returncode=0)
        info = self.optimizer.get_video_info(Path("test.mp4"))
        assert info is not None
        assert (info.width, info.height, info.fps) == (1920, 1080, 30.0)
        assert info.codec == "h264" and info.audio_codec == "aac"

    @patch("subprocess.run")
    def test_get_video_info_failure(self, mock_run):
        mock_run.side_effect = Exception("ffprobe failed")
        assert self.optimizer.get_video_info(Path("test.mp4")) is None

    @pytest.mark.parametrize("dims,bounds,expected", [
        ((1920, 1080), (None, None), (1920, 1080)),
        ((1920, 1080), (1280, None), (1280, 720)),
        ((1920, 1080), (None, 720), (1280, 720)),
        ((1920, 1080), (1280, 720), (1280, 720)),
        ((640, 480), (1920, 1080), (640, 480)),  # never upscale
        ((1281, 721), (None, None), (1280, 720)),  # odd source becomes even
        ((1080, 1920), (720, 720), (404, 720)),  # portrait fits the binding axis
    ])
    def test_calculate_target_resolution(self, dims, bounds, expected):
        assert self.optimizer.calculate_target_resolution(*dims, *bounds) == expected

    def test_calculate_target_resolution_even_dimensions(self):
        width, height = self.optimizer.calculate_target_resolution(1920, 1080, 1279, None)
        assert width % 2 == 0 and height % 2 == 0

    def test_unknown_dimensions_rejected(self):
        with pytest.raises(ValueError):
            self.optimizer.calculate_target_resolution(0, 0, None, None)

    @patch("subprocess.run")
    @patch.object(VideoOptimizer, "get_video_info")
    def test_dry_run_is_side_effect_free(self, mock_get_info, mock_run, tmp_path):
        src = tmp_path / "input.mp4"
        src.write_bytes(b"source")
        mock_get_info.return_value = make_info()
        optimizer = VideoOptimizer(dry_run=True)
        before = sorted(p.name for p in tmp_path.iterdir())
        assert optimizer.optimize_video(src, max_width=1280, drop_silent_audio=True) is True
        mock_run.assert_not_called()
        assert sorted(p.name for p in tmp_path.iterdir()) == before
        assert optimizer.last_receipt["status"] == "dry-run"
        assert "scale=1280:720" in optimizer.last_receipt["commands"][0]

    @patch("subprocess.run")
    @patch.object(VideoOptimizer, "get_video_info")
    def test_existing_output_is_never_overwritten_silently(self, mock_get_info, mock_run, tmp_path):
        src = tmp_path / "input.mp4"
        src.write_bytes(b"source")
        out = tmp_path / "out.mp4"
        out.write_bytes(b"precious")
        mock_get_info.return_value = make_info()
        assert self.optimizer.optimize_video(src, out) is False
        assert out.read_bytes() == b"precious"
        mock_run.assert_not_called()
        assert "already exists" in self.optimizer.last_receipt["error"]

    @patch("subprocess.run")
    @patch.object(VideoOptimizer, "get_video_info")
    def test_source_is_never_the_output(self, mock_get_info, mock_run, tmp_path):
        src = tmp_path / "input.mp4"
        src.write_bytes(b"source")
        mock_get_info.return_value = make_info()
        assert self.optimizer.optimize_video(src, src, replace_output=True) is False
        assert src.read_bytes() == b"source"

    def test_derived_output_paths_are_fresh(self, tmp_path):
        src = tmp_path / "clip.mov"
        (tmp_path / "clip.optimized.mp4").write_bytes(b"old")
        assert derive_output_path(src, ".mp4").name == "clip.optimized-2.mp4"

    @patch.object(VideoOptimizer, "get_video_info")
    def test_extension_must_match_profile(self, mock_get_info, tmp_path):
        mock_get_info.return_value = make_info()
        assert self.optimizer.optimize_video(tmp_path / "in.mp4", tmp_path / "out.mp4", codec="vp9") is False
        assert ".webm" in self.optimizer.last_receipt["error"]

    def _plan(self, info, **kw):
        args = dict(max_width=None, max_height=None, target_fps=None, crf=23, audio_bitrate="128k",
                    preset="medium", two_pass=False, audio_mode="encode", subtitle_mode="keep",
                    allow_format_downgrade=False)
        args.update(kw)
        profile = PROFILES[args.pop("codec", "h264")]
        return self.optimizer.build_plan(info, Path("in.mp4"), Path(".out.partial.mp4"), profile,
                                         args.pop("encoder", profile.encoders[0]), **args)

    def test_h264_default_keeps_audio_and_faststart(self):
        cmd = self._plan(make_info())["commands"][-1]
        assert cmd[cmd.index("-c:v") + 1] == "libx264"
        assert cmd[cmd.index("-c:a") + 1] == "aac"
        assert "0:a?" in cmd and "+faststart" in cmd and "-y" not in cmd and "-n" in cmd
        assert cmd[cmd.index("-pix_fmt") + 1] == "yuv420p"

    def test_no_fps_cap_without_intent(self):
        cmd = self._plan(make_info(fps=60.0))["commands"][-1]
        assert "-r" not in cmd
        # The muxer must not force constant frame rate onto a variable-rate source.
        flag = "-fps_mode" if "-fps_mode" in cmd else "-vsync"
        assert cmd[cmd.index(flag) + 1] == "vfr"

    def test_video_mapped_by_stream_index(self):
        cmd = self._plan(make_info(video_index=2))["commands"][-1]
        assert cmd[cmd.index("-map") + 1] == "0:2"

    def test_webm_alpha_decoded_with_libvpx_and_cleared_when_flattened(self):
        info = make_info(codec="vp9", has_alpha=True, container="matroska,webm")
        vp9 = self._plan(info, codec="vp9", crf=33)
        cmd = vp9["commands"][-1]
        assert cmd[cmd.index("-c:v") + 1] == "libvpx-vp9" and cmd.index("-c:v") < cmd.index("-i")
        assert vp9["expected"]["alpha"] is True and "alpha_mode=" not in cmd
        flat = self._plan(info, allow_format_downgrade=True)["commands"][-1]
        assert flat[flat.index("-c:v") + 1] == "libx264" and "alpha_mode=" in flat

    def test_hdr_downgrade_is_retagged(self):
        plan = self._plan(make_info(hdr=True, color_transfer="smpte2084"), allow_format_downgrade=True)
        cmd = plan["commands"][-1]
        assert cmd[cmd.index("-color_trc") + 1] == "bt709" and any("tone mapping" in w for w in plan["warnings"])

    def test_fps_is_lowered_never_raised(self):
        assert "-r" in self._plan(make_info(fps=60.0), target_fps=30.0)["commands"][-1]
        plan = self._plan(make_info(fps=24.0), target_fps=30.0)
        assert "-r" not in plan["commands"][-1]
        assert any("not below" in w for w in plan["warnings"])

    def test_explicit_audio_drop_only(self):
        assert "-an" in self._plan(make_info(), audio_mode="drop")["commands"][-1]
        assert self._plan(make_info(), audio_mode="drop")["expected"]["audio_streams"] == 0

    def test_codec_profiles_use_their_own_quality_knobs(self):
        vp9 = self._plan(make_info(), codec="vp9", crf=33)["commands"][-1]
        assert vp9[vp9.index("-c:v") + 1] == "libvpx-vp9" and "-b:v" in vp9 and "libopus" in vp9 and "+faststart" not in vp9
        hevc = self._plan(make_info(), codec="hevc", crf=28)["commands"][-1]
        assert hevc[hevc.index("-tag:v") + 1] == "hvc1"
        av1 = self._plan(make_info(), codec="av1", crf=35)["commands"][-1]
        assert av1[av1.index("-preset") + 1] == "8"  # svt-av1 numeric preset for "medium"

    def test_hdr_and_alpha_are_refused_not_silently_changed(self):
        assert self._plan(make_info(hdr=True, color_transfer="smpte2084"))["errors"]
        assert self._plan(make_info(has_alpha=True, pix_fmt="yuva420p"))["errors"]
        vp9 = self._plan(make_info(has_alpha=True, pix_fmt="yuva420p"), codec="vp9", crf=33)
        assert not vp9["errors"] and vp9["commands"][-1][vp9["commands"][-1].index("-pix_fmt") + 1] == "yuva420p"

    def test_ten_bit_kept_where_supported(self):
        info = make_info(bit_depth=10, pix_fmt="yuv420p10le")
        hevc = self._plan(info, codec="hevc", crf=28)["commands"][-1]
        assert hevc[hevc.index("-pix_fmt") + 1] == "yuv420p10le"
        h264 = self._plan(info)
        assert any("8-bit" in w for w in h264["warnings"])

    def test_subtitles_kept_as_text_and_bitmap_refused(self):
        text = make_info(subtitle_streams=[StreamSummary(2, "subtitle", "subrip")])
        cmd = self._plan(text)["commands"][-1]
        assert cmd[cmd.index("-c:s") + 1] == "mov_text"
        bitmap = make_info(subtitle_streams=[StreamSummary(2, "subtitle", "hdmv_pgs_subtitle", bitmap=True)])
        assert self._plan(bitmap)["errors"]
        assert not self._plan(bitmap, subtitle_mode="drop")["errors"]

    def test_two_pass_only_for_h264_with_bitrate(self):
        plan = self._plan(make_info(), two_pass=True)
        assert len(plan["commands"]) == 2 and "-pass" in plan["commands"][0]
        assert self._plan(make_info(), codec="vp9", crf=33, two_pass=True)["errors"]
        assert self._plan(make_info(bitrate=0), two_pass=True)["errors"]

    @patch("video_optimize.decode_check", return_value=None)
    @patch.object(VideoOptimizer, "get_video_info")
    def test_success_promotes_staged_output(self, mock_get_info, _decode, tmp_path):
        src = tmp_path / "input.mp4"
        src.write_bytes(b"s" * 5000)
        out_info = make_info(width=1280, height=720)
        mock_get_info.side_effect = [make_info(), out_info]
        with patch("subprocess.run", side_effect=fake_encoder(1000)):
            assert self.optimizer.optimize_video(src, max_width=1280) is True
        receipt = self.optimizer.last_receipt
        assert receipt["status"] == "ok" and receipt["savings_pct"] == 80.0
        assert Path(receipt["output"]).read_bytes() == b"x" * 1000
        assert src.read_bytes() == b"s" * 5000
        assert not list(tmp_path.glob(".*partial*"))

    @patch("video_optimize.decode_check", return_value=None)
    @patch.object(VideoOptimizer, "get_video_info")
    def test_larger_output_is_rejected_and_removed(self, mock_get_info, _decode, tmp_path):
        src = tmp_path / "input.mp4"
        src.write_bytes(b"s" * 100)
        mock_get_info.side_effect = [make_info(), make_info()]
        with patch("subprocess.run", side_effect=fake_encoder(500)):
            assert self.optimizer.optimize_video(src) is False
        assert self.optimizer.last_receipt["status"] == "rejected"
        assert sorted(p.name for p in tmp_path.iterdir()) == ["input.mp4"]

    @patch("video_optimize.decode_check", return_value="Invalid data found")
    @patch.object(VideoOptimizer, "get_video_info")
    def test_failed_decode_gates_success(self, mock_get_info, _decode, tmp_path):
        src = tmp_path / "input.mp4"
        src.write_bytes(b"s" * 5000)
        mock_get_info.side_effect = [make_info(), make_info()]
        with patch("subprocess.run", side_effect=fake_encoder(100)):
            assert self.optimizer.optimize_video(src) is False
        assert "decode" in self.optimizer.last_receipt["error"]
        assert sorted(p.name for p in tmp_path.iterdir()) == ["input.mp4"]

    @patch("video_optimize.decode_check", return_value=None)
    @patch.object(VideoOptimizer, "get_video_info")
    def test_lost_audio_track_gates_success(self, mock_get_info, _decode, tmp_path):
        src = tmp_path / "input.mp4"
        src.write_bytes(b"s" * 5000)
        mock_get_info.side_effect = [make_info(), make_info(audio_streams=[], audio_codec="none")]
        with patch("subprocess.run", side_effect=fake_encoder(100)):
            assert self.optimizer.optimize_video(src) is False
        assert "audio" in self.optimizer.last_receipt["error"]

    @patch("video_optimize.decode_check", return_value=None)
    @patch.object(VideoOptimizer, "get_video_info")
    def test_replace_output_keeps_backup(self, mock_get_info, _decode, tmp_path):
        src = tmp_path / "input.mp4"
        src.write_bytes(b"s" * 5000)
        out = tmp_path / "web.mp4"
        out.write_bytes(b"o" * 1000)
        mock_get_info.side_effect = [make_info(), make_info()]
        with patch("subprocess.run", side_effect=fake_encoder(100)):
            assert self.optimizer.optimize_video(src, out, replace_output=True) is True
        backup = Path(self.optimizer.last_receipt["replaced_backup"])
        assert backup.read_bytes() == b"o" * 1000 and out.read_bytes() == b"x" * 100
        assert self.optimizer.last_receipt["bytes"]["replaced"] == 1000

    @patch("video_optimize.decode_check", return_value=None)
    @patch.object(VideoOptimizer, "get_video_info")
    def test_replace_output_refuses_larger_than_existing(self, mock_get_info, _decode, tmp_path):
        src = tmp_path / "input.mp4"
        src.write_bytes(b"s" * 5000)
        out = tmp_path / "web.mp4"
        out.write_bytes(b"o" * 50)  # already optimized and smaller than the new encode
        mock_get_info.side_effect = [make_info(), make_info()]
        with patch("subprocess.run", side_effect=fake_encoder(100)):
            assert self.optimizer.optimize_video(src, out, replace_output=True) is False
        assert self.optimizer.last_receipt["status"] == "rejected"
        assert "existing web.mp4" in self.optimizer.last_receipt["error"]
        assert out.read_bytes() == b"o" * 50
        assert sorted(p.name for p in tmp_path.iterdir()) == ["input.mp4", "web.mp4"]

    @patch("video_optimize.decode_check", return_value=None)
    @patch.object(VideoOptimizer, "get_video_info")
    def test_replace_output_refuses_equal_size(self, mock_get_info, _decode, tmp_path):
        src = tmp_path / "input.mp4"
        src.write_bytes(b"s" * 5000)
        out = tmp_path / "web.mp4"
        out.write_bytes(b"o" * 100)
        mock_get_info.side_effect = [make_info(), make_info()]
        with patch("subprocess.run", side_effect=fake_encoder(100)):
            assert self.optimizer.optimize_video(src, out, replace_output=True) is False
        assert self.optimizer.last_receipt["bytes"]["replaced"] == 100
        assert out.read_bytes() == b"o" * 100

    @patch("video_optimize.decode_check", return_value=None)
    @patch.object(VideoOptimizer, "get_video_info")
    def test_replace_output_records_target_when_source_check_rejects(self, mock_get_info, _decode, tmp_path):
        src = tmp_path / "input.mp4"
        src.write_bytes(b"s" * 50)
        out = tmp_path / "web.mp4"
        out.write_bytes(b"o" * 30)
        mock_get_info.side_effect = [make_info(), make_info()]
        with patch("subprocess.run", side_effect=fake_encoder(100)):
            assert self.optimizer.optimize_video(src, out, replace_output=True) is False
        receipt = self.optimizer.last_receipt
        assert "than the source" in receipt["error"] and receipt["bytes"]["replaced"] == 30
        assert out.read_bytes() == b"o" * 30

    @patch("video_optimize.decode_check", return_value=None)
    @patch.object(VideoOptimizer, "get_video_info")
    def test_replace_output_keep_larger_overrides(self, mock_get_info, _decode, tmp_path):
        src = tmp_path / "input.mp4"
        src.write_bytes(b"s" * 5000)
        out = tmp_path / "web.mp4"
        out.write_bytes(b"o" * 50)
        mock_get_info.side_effect = [make_info(), make_info()]
        with patch("subprocess.run", side_effect=fake_encoder(100)):
            assert self.optimizer.optimize_video(src, out, replace_output=True,
                                                 keep_larger=True) is True
        assert out.read_bytes() == b"x" * 100
        assert Path(self.optimizer.last_receipt["replaced_backup"]).read_bytes() == b"o" * 50

    @patch("video_optimize.decode_check", return_value=None)
    @patch.object(VideoOptimizer, "get_video_info")
    def test_failed_promotion_restores_previous_output(self, mock_get_info, _decode, tmp_path):
        src = tmp_path / "in.mp4"
        src.write_bytes(b"x" * 5000)
        out = tmp_path / "out.mp4"
        out.write_bytes(b"previous" * 100)
        mock_get_info.side_effect = [make_info(), make_info()]
        real_replace = os.replace

        def replace(a, b):
            if ".partial-" in str(a):
                raise PermissionError("file is open in another program")
            return real_replace(a, b)

        with patch("subprocess.run", side_effect=fake_encoder(100)), patch("os.replace", side_effect=replace):
            assert self.optimizer.optimize_video(src, out, replace_output=True) is False
        assert out.read_bytes() == b"previous" * 100
        assert sorted(p.name for p in tmp_path.iterdir()) == ["in.mp4", "out.mp4"]
        assert "could not move" in self.optimizer.last_receipt["error"]

    @patch.object(VideoOptimizer, "get_video_info")
    def test_hard_link_to_source_is_the_source(self, mock_get_info, tmp_path):
        src = tmp_path / "in.mp4"
        src.write_bytes(b"x" * 5000)
        alias = tmp_path / "alias.mp4"
        os.link(src, alias)
        mock_get_info.return_value = make_info()
        assert self.optimizer.optimize_video(src, alias, replace_output=True) is False
        assert "source" in self.optimizer.last_receipt["error"]

    @patch.object(VideoOptimizer, "get_video_info")
    def test_encode_failure_cleans_up(self, mock_get_info, tmp_path):
        src = tmp_path / "input.mp4"
        src.write_bytes(b"s")
        mock_get_info.return_value = make_info()

        def boom(cmd, **kwargs):
            Path(cmd[-1]).write_bytes(b"partial")
            raise subprocess.CalledProcessError(1, cmd)

        with patch("subprocess.run", side_effect=boom):
            assert self.optimizer.optimize_video(src) is False
        assert sorted(p.name for p in tmp_path.iterdir()) == ["input.mp4"]


class TestCompareVideos:
    @patch.object(VideoOptimizer, "get_video_info")
    def test_compare_videos_success(self, mock_get_info, capsys):
        mock_get_info.side_effect = [
            make_info(),
            make_info(width=1280, height=720, bitrate=2500000, size=37500000),
        ]
        VideoOptimizer().compare_videos(Path("original.mp4"), Path("optimized.mp4"))
        out = capsys.readouterr().out
        assert "1920x1080" in out and "1280x720" in out and "-50.0%" in out

    @patch.object(VideoOptimizer, "get_video_info")
    def test_compare_handles_zero_metadata(self, mock_get_info, capsys):
        mock_get_info.side_effect = [make_info(bitrate=0, size=0), make_info()]
        VideoOptimizer().compare_videos(Path("a.mp4"), Path("b.mp4"))
        assert "n/a" in capsys.readouterr().out


class TestMissingDependencies:
    def test_main_reports_missing_ffmpeg(self, tmp_path, capsys):
        src = tmp_path / "in.mp4"
        src.write_bytes(b"x")
        with patch("subprocess.run", side_effect=FileNotFoundError()):
            assert main([str(src)]) == 1
        assert "FFmpeg/FFprobe not found" in capsys.readouterr().err

    def test_main_rejects_encoder_outside_profile(self, tmp_path, capsys):
        src = tmp_path / "in.mp4"
        src.write_bytes(b"x")
        with patch.object(VideoOptimizer, "check_ffmpeg", return_value=True):
            assert main([str(src), "--encoder", "h264_nvenc"]) == 1
        assert "not part of the h264 profile" in capsys.readouterr().err

    def test_main_reports_missing_encoder(self, tmp_path, capsys):
        src = tmp_path / "in.mp4"
        src.write_bytes(b"x")
        with patch.object(VideoOptimizer, "check_ffmpeg", return_value=True), \
                patch.object(video_optimize, "available_encoders", return_value={"libx264"}):
            assert main([str(src), "--codec", "vp9"]) == 1
        assert "libvpx-vp9" in capsys.readouterr().err


# --- FFmpeg fixture integration tests -------------------------------------------------------


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def clip(path: Path, size: str = "320x240", seconds: str = "1", audio: str = "sine=frequency=440", crf: str = "10",
         extra=()) -> Path:
    inputs = ["-f", "lavfi", "-i", f"testsrc2=size={size}:rate=30"]
    if audio:
        inputs += ["-f", "lavfi", "-i", audio]
    ffmpeg(*inputs, "-t", seconds, "-c:v", "libx264", "-crf", crf, "-pix_fmt", "yuv420p",
           *(["-c:a", "aac"] if audio else []), *extra, str(path))
    return path


def run_cli(*args: str):
    script = Path(__file__).parent.parent / "video_optimize.py"
    return subprocess.run([sys.executable, str(script), *args, "--json"], capture_output=True, text=True)


@needs_ffmpeg
class TestFfmpegIntegration:
    def test_compress_creates_verified_h264_with_receipt(self, tmp_path):
        src = clip(tmp_path / "hero.mp4", size="640x360", seconds="2")
        result = run_cli(str(src), "-w", "320")
        assert result.returncode == 0, result.stderr
        receipt = json.loads(result.stdout)
        out = Path(receipt["output"])
        assert out.name == "hero.optimized.mp4" and out.exists()
        assert receipt["output_info"]["codec"] == "h264"
        assert (receipt["output_info"]["display_width"], receipt["output_info"]["display_height"]) == (320, 180)
        assert len(receipt["output_info"]["audio_streams"]) == 1
        assert receipt["html_type"].startswith('video/mp4; codecs="avc1.')
        assert receipt["bytes"]["output"] < receipt["bytes"]["source"]
        assert "encode_seconds" in receipt and receipt["commands"]

    def test_odd_and_rotated_source(self, tmp_path):
        base = clip(tmp_path / "base.mp4", size="322x242", crf="5")
        rotated = tmp_path / "rot.mp4"
        ffmpeg("-display_rotation", "90", "-i", str(base), "-c", "copy", str(rotated))
        result = run_cli(str(rotated), "-H", "201")
        assert result.returncode == 0, result.stderr
        out = json.loads(result.stdout)["output_info"]
        # Display is portrait 242x322; the height bound of 201 gives an even 150x200 portrait frame.
        assert (out["display_width"], out["display_height"]) == (150, 200)
        assert out["rotation"] == 0

    def test_vfr_source_keeps_timing(self, tmp_path):
        vfr = tmp_path / "vfr.mp4"
        ffmpeg("-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30", "-t", "2",
               "-vf", "select='lt(n\\,30)+not(mod(n\\,3))'", "-fps_mode", "vfr", "-c:v", "libx264", "-crf", "5", str(vfr))
        result = run_cli(str(vfr))
        assert result.returncode == 0, result.stderr
        receipt = json.loads(result.stdout)
        assert receipt["source_info"]["vfr"] is True
        assert any("variable frame rate" in w for w in receipt["warnings"])
        assert abs(receipt["output_info"]["duration"] - receipt["source_info"]["duration"]) < 0.2
        # No duplicated frames: the output carries the source's frames, not r_frame_rate x duration.
        assert video_frame_count(Path(receipt["output"])) == video_frame_count(vfr)
        assert receipt["output_info"]["fps"] == pytest.approx(receipt["source_info"]["fps"], rel=0.05)

    def test_captions_are_preserved(self, tmp_path):
        base = clip(tmp_path / "base.mp4", crf="5")
        srt = tmp_path / "c.srt"
        srt.write_text("1\n00:00:00,000 --> 00:00:00,800\nhello\n")
        captioned = tmp_path / "captioned.mkv"
        ffmpeg("-i", str(base), "-i", str(srt), "-map", "0", "-map", "1", "-c:v", "copy", "-c:a", "copy", "-c:s", "srt", str(captioned))
        result = run_cli(str(captioned))
        assert result.returncode == 0, result.stderr
        assert [s["codec"] for s in json.loads(result.stdout)["output_info"]["subtitle_streams"]] == ["mov_text"]

    def test_silent_audio_dropped_only_on_request(self, tmp_path):
        silent = clip(tmp_path / "silent.mp4", audio="anullsrc=r=48000:cl=stereo", crf="5")
        kept = run_cli(str(silent))
        assert len(json.loads(kept.stdout)["output_info"]["audio_streams"]) == 1
        dropped = run_cli(str(silent), "--drop-silent-audio")
        assert dropped.returncode == 0, dropped.stderr
        assert json.loads(dropped.stdout)["output_info"]["audio_streams"] == []

    def test_audible_audio_survives_drop_silent_flag(self, tmp_path):
        loud = clip(tmp_path / "loud.mp4", crf="5")
        receipt = json.loads(run_cli(str(loud), "--drop-silent-audio").stdout)
        assert len(receipt["output_info"]["audio_streams"]) == 1
        assert receipt["audio_peaks_dbfs"][0] > -60

    def test_any_audible_track_keeps_all_audio(self, tmp_path):
        base = clip(tmp_path / "base.mp4", audio="anullsrc=r=48000:cl=stereo", crf="5")
        two = tmp_path / "two.mp4"
        ffmpeg("-i", str(base), "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-map", "0:v", "-map", "0:a",
               "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest", str(two))
        receipt = json.loads(run_cli(str(two), "--drop-silent-audio").stdout)
        assert receipt["status"] == "ok", receipt.get("error")
        assert len(receipt["output_info"]["audio_streams"]) == 2
        assert receipt["audio_peaks_dbfs"][0] <= -60 < receipt["audio_peaks_dbfs"][1]

    def test_webm_alpha_survives_vp9_and_is_refused_by_h264(self, tmp_path):
        src = tmp_path / "alpha.webm"
        ffmpeg("-f", "lavfi", "-i", "color=c=red@0.5:s=64x64:d=1:r=10,format=yuva420p",
               "-c:v", "libvpx-vp9", "-crf", "4", "-b:v", "0", "-pix_fmt", "yuva420p", str(src))
        refused = run_cli(str(src))
        assert refused.returncode == 1 and "alpha" in json.loads(refused.stdout)["error"]
        kept = run_cli(str(src), "--codec", "vp9", "--keep-larger")
        assert kept.returncode == 0, kept.stderr
        receipt = json.loads(kept.stdout)
        assert receipt["source_info"]["has_alpha"] and receipt["output_info"]["has_alpha"]
        alpha = subprocess.run(["ffmpeg", "-v", "error", "-c:v", "libvpx-vp9", "-i", receipt["output"], "-vf",
                                "alphaextract,format=gray", "-frames:v", "1", "-f", "rawvideo", "-"], capture_output=True)
        assert alpha.stdout and 100 < alpha.stdout[0] < 160  # half transparent, not flattened to 255
        flat = json.loads(run_cli(str(src), "--allow-format-downgrade", "--keep-larger").stdout)
        assert flat["status"] == "ok" and flat["output_info"]["has_alpha"] is False

    def test_batch_loop_stdin_is_not_consumed(self, tmp_path):
        clip(tmp_path / "a.mp4", crf="5")
        clip(tmp_path / "b.mp4", crf="5")
        script = Path(__file__).parent.parent / "video_optimize.py"
        loop = f'while read f; do "{sys.executable}" "{script}" "$f" --json >/dev/null || echo "FAIL $f"; done'
        result = subprocess.run(["bash", "-c", loop], input="a.mp4\nb.mp4\n", capture_output=True, text=True, cwd=tmp_path)
        assert "FAIL" not in result.stdout, result.stdout + result.stderr
        assert (tmp_path / "a.optimized.mp4").exists() and (tmp_path / "b.optimized.mp4").exists()

    @pytest.mark.skipif(sys.platform == "win32", reason="POSIX signal")
    def test_sigterm_removes_staged_file_and_stops_ffmpeg(self, tmp_path):
        src = clip(tmp_path / "long.mp4", size="1280x720", seconds="20", crf="30")
        script = Path(__file__).parent.parent / "video_optimize.py"
        proc = subprocess.Popen([sys.executable, str(script), str(src), "--preset", "veryslow"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 30
        while not list(tmp_path.glob(".long.optimized.partial-*")) and time.monotonic() < deadline:
            time.sleep(0.1)
        assert list(tmp_path.glob(".long.optimized.partial-*")), "encode did not start"
        proc.send_signal(signal.SIGTERM)
        assert proc.wait(timeout=30) != 0
        time.sleep(0.5)
        assert sorted(p.name for p in tmp_path.iterdir()) == ["long.mp4"]
        leftover = subprocess.run(["pgrep", "-f", str(src)], capture_output=True, text=True)
        assert leftover.stdout.strip() == ""

    def test_no_saving_is_rejected_without_writing(self, tmp_path):
        tiny = clip(tmp_path / "tiny.mp4", audio="", crf="51")
        result = run_cli(str(tiny), "--crf", "0")
        assert result.returncode == 3
        assert json.loads(result.stdout)["status"] == "rejected"
        assert sorted(p.name for p in tmp_path.iterdir()) == ["tiny.mp4"]

    def test_replace_output_never_grows_a_smaller_target(self, tmp_path):
        src = clip(tmp_path / "in.mp4", size="640x360", seconds="2", crf="5")
        site = clip(tmp_path / "site.mp4", size="640x360", seconds="2", crf="45")
        shipped_bytes = site.read_bytes()
        result = run_cli(str(src), "-o", str(site), "--crf", "18", "--replace-output")
        assert result.returncode == 3, result.stderr
        receipt = json.loads(result.stdout)
        assert receipt["status"] == "rejected"
        assert receipt["bytes"]["replaced"] == len(shipped_bytes) < receipt["bytes"]["output"]
        assert site.read_bytes() == shipped_bytes
        assert sorted(p.name for p in tmp_path.iterdir()) == ["in.mp4", "site.mp4"]

        smaller = run_cli(str(src), "-o", str(site), "--crf", "51", "-w", "160", "--audio-bitrate", "32k",
                          "--replace-output")
        assert smaller.returncode == 0, smaller.stderr
        receipt = json.loads(smaller.stdout)
        assert receipt["bytes"]["output"] < receipt["bytes"]["replaced"] == len(shipped_bytes)
        assert Path(receipt["replaced_backup"]).read_bytes() == shipped_bytes

    def test_corrupt_source_fails_cleanly(self, tmp_path):
        bad = tmp_path / "bad.mp4"
        bad.write_bytes(b"\x00" * 2048)
        result = run_cli(str(bad))
        assert result.returncode == 1
        assert sorted(p.name for p in tmp_path.iterdir()) == ["bad.mp4"]

    def test_vp9_profile_with_h264_fallback_alongside(self, tmp_path):
        src = clip(tmp_path / "loop.mp4", crf="5")
        h264 = json.loads(run_cli(str(src)).stdout)
        vp9_run = run_cli(str(src), "--codec", "vp9", "--preset", "veryfast")
        assert vp9_run.returncode == 0, vp9_run.stderr
        vp9 = json.loads(vp9_run.stdout)
        assert Path(h264["output"]).exists() and Path(vp9["output"]).suffix == ".webm"
        assert vp9["html_type"] == 'video/webm; codecs="vp9, opus"'

    def test_dry_run_and_rerun_never_overwrite(self, tmp_path):
        src = clip(tmp_path / "a.mp4", crf="5")
        assert run_cli(str(src), "-n").returncode == 0
        assert sorted(p.name for p in tmp_path.iterdir()) == ["a.mp4"]
        first = json.loads(run_cli(str(src)).stdout)["output"]
        second = json.loads(run_cli(str(src)).stdout)["output"]
        assert Path(first).name == "a.optimized.mp4" and Path(second).name == "a.optimized-2.mp4"
        explicit = run_cli(str(src), "-o", first)
        assert explicit.returncode == 1 and "already exists" in explicit.stderr

    def test_two_pass_cleans_its_logs(self, tmp_path):
        src = clip(tmp_path / "a.mp4", crf="5", seconds="2")
        result = subprocess.run([sys.executable, str(Path(__file__).parent.parent / "video_optimize.py"), str(src),
                                 "--two-pass", "--json"], capture_output=True, text=True, cwd=tmp_path)
        assert result.returncode == 0, result.stderr
        assert not list(tmp_path.glob("*2pass*"))


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
