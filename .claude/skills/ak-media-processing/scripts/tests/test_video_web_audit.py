#!/usr/bin/env python3
"""Tests for video_web_audit.py and capture_rendered_videos.mjs."""

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, Tuple

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import video_web_audit as audit  # noqa: E402
from video_web_audit import main, run_audit, scan_text, target_dims  # noqa: E402

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
needs_ffmpeg = pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg/ffprobe not installed")


def _node_has_playwright() -> bool:
    if shutil.which("node") is None:
        return False
    probe = "import('playwright').catch(() => require('playwright'))"
    try:
        return subprocess.run(["node", "-e", probe], capture_output=True, timeout=60).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def write(root: Path, rel: str, content: str = "") -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def make_clip(path: Path, size: str = "320x240", audio: bool = True, codec: str = "libx264") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size={size}:rate=25:duration=1"]
    if audio:
        cmd += ["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac"]
    cmd += ["-c:v", codec, "-pix_fmt", "yuv420p", "-shortest", str(path)]
    subprocess.run(cmd, check=True, capture_output=True)


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "site"
    write(root, "index.html", """<html><body>
<video autoplay muted loop playsinline poster="/img/hero.jpg">
  <source src="/videos/hero.webm" type="video/webm" media="(min-width: 800px)">
  <source src="/videos/hero.mp4?v=2" type="video/mp4">
</video>
<video src="https://cdn.example.com/a.mp4" controls></video>
<video src="/stream/master.m3u8"></video>
<video src="/videos/missing.mp4"></video>
</body></html>
""")
    write(root, "src/components/Hero.jsx", """import heroClip from '../media/clip.mp4';
export const Hero = () => (
  <video src={heroClip} autoPlay muted playsInline onClick={() => go()} />
);
""")
    write(root, "src/App.vue", '<template><video :src="\'/videos/hero.mp4\'" controls muted></video></template>\n')
    write(root, "docs/guide.md", "See [demo](../public/videos/hero.mp4#t=3).\n")
    write(root, "styles/site.css", ".bg { background: url('/videos/bg.mp4'); }\n")
    write(root, "node_modules/pkg/index.js", "const v = '/videos/hero.mp4';\n")
    for rel in ("public/videos/hero.mp4", "public/videos/hero.webm", "src/media/clip.mp4", "public/videos/bg.mp4"):
        write(root, rel, "not a real video " + rel)
    return root


def snapshot(root: Path) -> Dict[str, Tuple[float, str]]:
    return {str(p.relative_to(root)): (p.stat().st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest())
            for p in sorted(root.rglob("*")) if p.is_file()}


def by_path(report):
    return {a["path"]: a for a in report["assets"]}


class TestScan:
    def test_html_video_sources_and_flags(self):
        html = '<video autoplay muted loop playsinline>\n<source src="/a.mp4?x=1" type="video/mp4" media="(x)">\n</video>'
        usages = scan_text("i.html", html)
        assert len(usages) == 1
        u = usages[0]
        assert (u.kind, u.ref, u.line, u.type, u.media) == ("source", "/a.mp4", 2, "video/mp4", "(x)")
        assert u.flags == {"autoplay": True, "muted": True, "loop": True, "playsinline": True, "controls": None}

    def test_jsx_import_binding_and_false_flag(self):
        text = "import v from './v.mp4';\nconst x = <video src={v} autoPlay={false} muted />;\n"
        usages = scan_text("a.jsx", text)
        assert [(u.kind, u.ref, u.line) for u in usages] == [("video-src", "./v.mp4", 2)]
        assert usages[0].flags["autoplay"] is False and usages[0].flags["muted"] is True

    def test_classify_external_adaptive_dynamic(self):
        text = '<video src="//cdn.x/a.mp4"></video><video src="/s/x.mpd"></video><video src="{{ url }}.mp4"></video>'
        assert [u.status for u in scan_text("t.njk", text)] == ["external", "adaptive", "dynamic"]


class TestProjectAudit:
    def test_references_resolution_and_dedup(self, project: Path, monkeypatch):
        monkeypatch.setattr(audit, "ffprobe_available", lambda: False)
        report = run_audit(project)
        assets = by_path(report)
        assert set(assets) == {"public/videos/hero.mp4", "public/videos/hero.webm", "src/media/clip.mp4",
                               "public/videos/bg.mp4"}
        hero = assets["public/videos/hero.mp4"]
        assert sorted(u["file"] for u in hero["usages"]) == ["docs/guide.md", "index.html", "src/App.vue"]
        assert all(a["probe_error"] == "ffprobe unavailable" for a in assets.values())
        assert hero["proposed_dims"] is None
        assert "fullscreen-possible" in hero["risks"]
        assert assets["public/videos/bg.mp4"]["usages"][0]["kind"] == "css-url"
        clip = assets["src/media/clip.mp4"]["usages"][0]
        assert (clip["file"], clip["line"], clip["flags"]["autoplay"]) == ("src/components/Hero.jsx", 3, True)
        assert any(r["id"] == "missing-poster" for r in assets["src/media/clip.mp4"]["recommendations"])
        statuses = {u["ref"]: (u["status"], u["source_confidence"]) for u in report["not_inspected"]}
        assert statuses == {"https://cdn.example.com/a.mp4": ("external", "external"),
                            "/stream/master.m3u8": ("adaptive", "external"),
                            "/videos/missing.mp4": ("unresolved", "unresolved")}
        assert {"path": "node_modules/", "reason": "ignored directory"} in report["skipped"]

    def test_identical_copies_flagged(self, tmp_path: Path, monkeypatch):
        monkeypatch.setattr(audit, "ffprobe_available", lambda: False)
        write(tmp_path, "a.html", '<video src="one.mp4"></video><video src="two.mp4"></video>')
        write(tmp_path, "one.mp4", "same")
        write(tmp_path, "two.mp4", "same")
        assets = by_path(run_audit(tmp_path))
        assert assets["one.mp4"]["identical_copies"] == ["two.mp4"]

    def test_exclude_and_large_file_skipped(self, tmp_path: Path, monkeypatch):
        monkeypatch.setattr(audit, "MAX_TEXT_BYTES", 10)
        write(tmp_path, "big.html", '<video src="a.mp4"></video>')
        write(tmp_path, "gen/x.html", "")
        reasons = {s["path"]: s["reason"] for s in run_audit(tmp_path, excludes=["gen"])["skipped"]}
        assert reasons == {"gen/": "excluded by --exclude", "big.html": "text file larger than 2 MB"}

    @pytest.mark.skipif(sys.platform == "win32", reason="symlinks need privileges on Windows")
    def test_broken_symlink_is_skipped_not_fatal(self, tmp_path: Path):
        write(tmp_path, "index.html", '<video src="a.mp4"></video>')
        (tmp_path / "broken.html").symlink_to(tmp_path / "missing.html")
        report = run_audit(tmp_path)
        assert any(s["path"] == "broken.html" and s["reason"].startswith("not readable") for s in report["skipped"])

    def test_read_only_main(self, project: Path, capsys):
        before = snapshot(project)
        assert main([str(project), "--json"]) == 0
        assert main([str(project), "--detect-silence"]) == 0
        assert snapshot(project) == before
        assert "# Video usage audit" in capsys.readouterr().out

    def test_bad_root_and_rendered(self, tmp_path: Path):
        assert main([str(tmp_path / "nope")]) == 1
        bad = write(tmp_path, "r.json", "{}")
        assert main([str(tmp_path), "--rendered", str(bad)]) == 1


    def test_rendered_file_inside_root_is_not_scanned(self, tmp_path: Path, capsys):
        write(tmp_path, "index.html", '<video src="/v/a.mp4"></video>')
        rendered = [{"pageUrl": "http://localhost/", "currentSrc": "http://localhost/v/a.mp4", "cssWidth": 10, "cssHeight": 10}]
        path = write(tmp_path, "rendered[1].json", json.dumps(rendered))
        assert main([str(tmp_path), "--rendered", str(path), "--json"]) == 0
        report = json.loads(capsys.readouterr().out)
        assert "rendered[1].json" not in json.dumps(report["not_inspected"])
        assert {"path": "rendered[1].json", "reason": "excluded by --exclude"} in report["skipped"]


class TestTargetDims:
    def test_two_x_rule_even(self):
        assert target_dims(1920, 1080, [(375, 211)], 2.0, False)[0] == [750, 422]

    def test_never_upscale(self):
        assert target_dims(640, 360, [(1440, 810)], 2.0, False)[0] == [640, 360]

    def test_largest_usage_wins(self):
        assert target_dims(1920, 1080, [(160, 90), (480, 270)], 2.0, False)[0] == [960, 540]

    def test_fullscreen_blocks_downscale(self):
        dims, reason = target_dims(1920, 1080, [(160, 90)], 2.0, True)
        assert dims == [1920, 1080] and reason.startswith("fullscreen-possible")

    def test_needs_measurement(self):
        assert target_dims(1920, 1080, [], 2.0, False) == (None, "needs browser measurement")

    def test_rendered_controls_block_downscale(self, tmp_path: Path, monkeypatch):
        monkeypatch.setattr(audit, "ffprobe_available", lambda: False)
        write(tmp_path, "a.html", '<video src="a.mp4" muted></video>')
        write(tmp_path, "a.mp4", "x")
        rendered = [{"pageUrl": "file:///a.html", "currentSrc": "file:///srv/a.mp4", "cssWidth": 100,
                     "cssHeight": 50, "attributes": {"controls": True}}]
        asset = run_audit(tmp_path, rendered)["assets"][0]
        assert "fullscreen-possible" in asset["risks"] and len(asset["rendered"]) == 1


@needs_ffmpeg
class TestWithFFmpeg:
    def test_probe_fields_and_recommendations(self, tmp_path: Path):
        make_clip(tmp_path / "public/v/clip.mp4")
        write(tmp_path, "index.html", '<video autoplay muted src="/v/clip.mp4"></video>')
        rendered = [{"pageUrl": "http://localhost/", "currentSrc": "http://localhost/v/clip.mp4", "cssWidth": 40,
                     "cssHeight": 30, "attributes": {"muted": True}}]
        asset = run_audit(tmp_path, rendered, detect_silence=True)["assets"][0]
        probe = asset["probe"]
        assert (probe["display_width"], probe["display_height"], probe["codec"]) == (320, 240, "h264")
        assert probe["has_audio"] is True and round(probe["fps"]) == 25 and probe["bitrate"] > 0
        assert asset["bits_per_pixel_frame"] == pytest.approx(probe["bitrate"] / (320 * 240 * probe["fps"]), abs=1e-3)
        assert asset["proposed_dims"] == [80, 60]
        ids = {r["id"]: r["detail"] for r in asset["recommendations"]}
        assert "estimated, unmeasured" in ids["oversized"]
        assert "confirm audio is not needed" in ids["audio-present-all-usages-muted"]
        assert "loudest track peak" in ids["audio-present-all-usages-muted"]

    def test_no_h264_fallback(self, tmp_path: Path):
        make_clip(tmp_path / "a.webm", audio=False, codec="libvpx-vp9")
        write(tmp_path, "i.html", '<video><source src="a.webm" type="video/webm"></video>')
        asset = run_audit(tmp_path)["assets"][0]
        assert any(r["id"] == "no-h264-fallback" for r in asset["recommendations"])


@needs_ffmpeg
@pytest.mark.skipif(not _node_has_playwright(), reason="node with playwright not available")
def test_browser_capture_feeds_audit(tmp_path: Path):
    root = tmp_path / "site"
    make_clip(root / "media/clip.mp4", size="640x360")
    page = write(root, "index.html",
                 '<html><body><video muted src="media/clip.mp4" style="width:160px;height:90px"></video></body></html>')
    proc = subprocess.run(["node", str(SCRIPTS / "capture_rendered_videos.mjs"), page.as_uri(),
                           "--viewport", "800x600", "--wait-ms", "100"],
                          capture_output=True, text=True, timeout=180, check=True)
    entries = json.loads(proc.stdout)
    assert entries and entries[0]["cssWidth"] == 160 and entries[0]["viewport"] == "800x600"
    rendered = tmp_path / "rendered.json"
    rendered.write_text(proc.stdout, encoding="utf-8")
    report = run_audit(root, audit.load_rendered([rendered]))
    assert by_path(report)["media/clip.mp4"]["proposed_dims"] == [320, 180]
