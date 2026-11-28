#!/usr/bin/env python3
"""Read-only audit of how a web project uses its video files.

Scans text sources for video references, resolves them to local files, probes
each file with ffprobe and, given rendered measurements from
``capture_rendered_videos.mjs``, proposes delivery dimensions. It never writes,
moves or encodes anything; all output goes to stdout.
"""

import argparse
import fnmatch
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from video_probe import SILENCE_DBFS, VideoInfo, audio_max_volume, even_floor, ffprobe_available, probe_video  # noqa: E402

TEXT_EXTS = {".html", ".htm", ".jsx", ".tsx", ".js", ".ts", ".mjs", ".vue", ".svelte", ".astro", ".md", ".mdx",
             ".php", ".erb", ".liquid", ".njk", ".hbs", ".json", ".yml", ".yaml", ".css"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "out", "coverage", "vendor", ".cache"}
MAX_TEXT_BYTES = 2 * 1024 * 1024
SEARCH_DIRS = ("", "public", "static", "src", "assets", "app")
VIDEO_EXTS = ("mp4", "webm", "mov", "m4v", "ogv", "mkv")
ADAPTIVE_EXTS = (".m3u8", ".mpd")
FLAG_NAMES = ("autoplay", "muted", "loop", "playsinline", "controls")
BPP_LIMITS = {"h264": 0.1, "hevc": 0.07, "vp9": 0.07, "av1": 0.07}
ESTIMATE_LABEL = "estimated, unmeasured"

_EXT_ALT = "|".join(VIDEO_EXTS + ("m3u8", "mpd"))
LITERAL_RE = re.compile(
    r"(?:(?<=['\"`(=])|(?<=: )|(?<=- ))([^\s'\"`()<>{}]+?\.(?:" + _EXT_ALT + r"))([?#][^\s'\"`()<>]*)?(?=['\"`)\s,]|$)",
    re.IGNORECASE | re.MULTILINE)
VIDEO_TAG_RE = re.compile(r"<video\b((?:[^>{]|\{[^}]*\})*?)(/?)>", re.IGNORECASE)
SOURCE_TAG_RE = re.compile(r"<source\b((?:[^>{]|\{[^}]*\})*?)/?>", re.IGNORECASE)
ATTR_RE = re.compile(r"([:@\w.-]+)(?:\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|\{([^}]*)\}|([^\s\"'>]+)))?")
IMPORT_RE = re.compile(r"import\s+(\w+)\s+from\s+['\"]([^'\"]+)['\"]")


@dataclass
class Usage:
    file: str
    line: int
    kind: str
    ref: str
    type: str = ""
    media: str = ""
    flags: Dict[str, Optional[bool]] = field(default_factory=dict)
    poster: str = ""
    element: str = ""
    status: str = "resolved"
    reason: str = ""
    asset: str = ""


@dataclass
class Asset:
    path: str
    usages: List[Usage] = field(default_factory=list)
    bytes: int = 0
    sha256: str = ""
    identical_copies: List[str] = field(default_factory=list)
    source_confidence: str = "resolved-local"
    probe: Optional[Dict[str, Any]] = None
    probe_error: str = ""
    bits_per_pixel_frame: Optional[float] = None
    rendered: List[Dict[str, Any]] = field(default_factory=list)
    proposed_dims: Optional[List[int]] = None
    proposed_reason: str = ""
    risks: List[str] = field(default_factory=list)
    recommendations: List[Dict[str, str]] = field(default_factory=list)
    evidence: List[str] = field(default_factory=list)


def _bool_attr(raw: Optional[str], present: bool) -> Optional[bool]:
    if not present:
        return None
    return (raw or "").strip().strip("{}").strip().lower() not in ("false", "0")


def parse_attrs(text: str) -> Dict[str, Optional[str]]:
    """Parse HTML/JSX/Vue attributes; names lower-cased, ``:src``/``v-bind:src`` normalized."""
    attrs: Dict[str, Optional[str]] = {}
    for m in ATTR_RE.finditer(text):
        name = re.sub(r"^(v-bind:|:|bind:)", "", m.group(1)).lower()
        value = next((g for g in m.groups()[1:] if g is not None), None)
        if value is not None:
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"`":
                value = value[1:-1]
        attrs[name] = value
    return attrs


def _flags(attrs: Dict[str, Optional[str]]) -> Dict[str, Optional[bool]]:
    return {n: _bool_attr(attrs.get(n), n in attrs) for n in FLAG_NAMES}


def classify_ref(ref: str) -> Tuple[str, str]:
    """Return (status, reason) for refs that cannot be resolved to a local file."""
    if "${" in ref or "{{" in ref or ref.startswith(("{", "<")):
        return "dynamic", "dynamic expression, value unknown statically"
    if ref.startswith(("data:", "blob:")):
        return "external", "inline data/blob URL, not inspected"
    if ref.lower().endswith(ADAPTIVE_EXTS):
        return "adaptive", "adaptive stream manifest (HLS/DASH), renditions not inspected"
    if ref.startswith(("http://", "https://", "//")):
        return "external", "external URL, not inspected (read-only offline audit)"
    return "resolved", ""


def scan_text(rel: str, text: str) -> List[Usage]:
    """Find video references in one file's text."""
    usages: List[Usage] = []
    covered: List[Tuple[int, int]] = []
    imports = {m.group(1): m.group(2) for m in IMPORT_RE.finditer(text)}
    used_imports = set()

    def line_of(pos: int) -> int:
        return text.count("\n", 0, pos) + 1

    def ref_of(value: Optional[str]) -> str:
        value = (value or "").strip()
        if value in imports:
            used_imports.add(value)
            return imports[value]
        return value

    for vm in VIDEO_TAG_RE.finditer(text):
        attrs = parse_attrs(vm.group(1))
        end = vm.end()
        body = ""
        if not vm.group(2):
            close = text.lower().find("</video>", end)
            if close != -1:
                body, end = text[vm.end():close], close + len("</video>")
        covered.append((vm.start(), end))
        element = f"{rel}:{line_of(vm.start())}"
        common = dict(flags=_flags(attrs), poster=ref_of(attrs.get("poster")), element=element)
        if attrs.get("src"):
            usages.append(Usage(rel, line_of(vm.start()), "video-src", ref_of(attrs["src"]), **common))
        for sm in SOURCE_TAG_RE.finditer(body):
            sattrs = parse_attrs(sm.group(1))
            if sattrs.get("src"):
                usages.append(Usage(rel, line_of(vm.end() + sm.start()), "source", ref_of(sattrs["src"]),
                                    type=sattrs.get("type") or "", media=sattrs.get("media") or "", **common))
    consumed = {imports[name] for name in used_imports}
    for lm in LITERAL_RE.finditer(text):
        if any(a <= lm.start() < b for a, b in covered) or lm.group(1) in consumed:
            continue
        kind = "css-url" if text[max(0, lm.start() - 6):lm.start()].lower().rstrip("'\" ").endswith("url(") else "literal"
        usages.append(Usage(rel, line_of(lm.start()), kind, lm.group(1)))
    for u in usages:
        u.ref = re.split(r"[?#]", u.ref, 1)[0] if not u.ref.startswith(("data:", "blob:")) else u.ref
        u.status, u.reason = classify_ref(u.ref)
    return usages


def resolve_ref(ref: str, source_file: Path, root: Path) -> Tuple[Optional[Path], str]:
    """Resolve a local reference to a real file inside ``root``."""
    clean = unquote(ref)
    bases: List[Path] = []
    if clean.startswith(("@/", "~/")):
        clean = clean[2:]
        bases = [root / "src", root]
    elif clean.startswith("/"):
        clean = clean.lstrip("/")
        bases = [root / d for d in SEARCH_DIRS]
    else:
        bases = [source_file.parent] + [root / d for d in SEARCH_DIRS]
    real_root = root.resolve()
    outside = False
    for base in bases:
        candidate = (base / clean)
        if candidate.is_file():
            real = candidate.resolve()
            if real_root == real or real_root in real.parents:
                return real, ""
            outside = True
    return None, "resolves outside the audit root" if outside else "file not found in referencing dir, root, " + \
        ", ".join(d for d in SEARCH_DIRS if d)


def iter_sources(root: Path, excludes: Sequence[str], skipped: List[Dict[str, str]]) -> Iterable[Path]:
    def unreadable(err: OSError) -> None:
        name = Path(err.filename or "")
        rel = name.relative_to(root).as_posix() if root in name.parents else str(name)
        skipped.append({"path": rel + "/", "reason": f"directory not readable: {err.strerror or err}"})

    for dirpath, dirnames, filenames in os.walk(root, onerror=unreadable):
        keep = []
        for d in sorted(dirnames):
            rel = (Path(dirpath) / d).relative_to(root).as_posix()
            if d in SKIP_DIRS or d.startswith("."):
                skipped.append({"path": rel + "/", "reason": "ignored directory"})
            elif any(fnmatch.fnmatch(rel, g) or fnmatch.fnmatch(d, g) for g in excludes):
                skipped.append({"path": rel + "/", "reason": "excluded by --exclude"})
            else:
                keep.append(d)
        dirnames[:] = keep
        for name in sorted(filenames):
            path = Path(dirpath) / name
            rel = path.relative_to(root).as_posix()
            if path.suffix.lower() not in TEXT_EXTS:
                continue
            if any(fnmatch.fnmatch(rel, g) or fnmatch.fnmatch(name, g) for g in excludes):
                skipped.append({"path": rel, "reason": "excluded by --exclude"})
                continue
            try:
                size = path.stat().st_size
            except OSError as exc:  # broken symlink, permission denied
                skipped.append({"path": rel, "reason": f"not readable: {exc.strerror or exc}"})
                continue
            if size > MAX_TEXT_BYTES:
                skipped.append({"path": rel, "reason": "text file larger than 2 MB"})
            else:
                yield path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def target_dims(src_w: int, src_h: int, measurements: Sequence[Tuple[float, float]], density: float,
                fullscreen: bool) -> Tuple[Optional[List[int]], str]:
    """Delivery size covering the largest rendered box at ``density``; never upscales."""
    boxes = [(w, h) for w, h in measurements if w > 0 and h > 0]
    if not src_w or not src_h:
        return None, "source dimensions unknown"
    if not measurements:
        return None, "needs browser measurement"
    if fullscreen:
        return [src_w, src_h], "fullscreen-possible: keep source resolution or add a separate larger variant"
    if not boxes:
        return None, "rendered size is zero (hidden or not laid out); needs measurement in a visible state"
    scale = min(1.0, max(max(density * w / src_w, density * h / src_h) for w, h in boxes))
    if scale >= 1.0:
        return [src_w, src_h], "rendered size at density needs the full source resolution"
    return [min(src_w, even_floor(src_w * scale)), min(src_h, even_floor(src_h * scale))], \
        f"largest rendered box x{density:g} density"


def _url_path(url: str) -> str:
    return unquote(urlparse(url).path or "")


def match_rendered(entry: Dict[str, Any], assets: Dict[str, Asset]) -> List[Asset]:
    """Assets whose path shares the longest path suffix with the element's currentSrc or src."""
    urls = [entry.get("currentSrc"), entry.get("src")] + [s.get("src") for s in entry.get("sources") or [] if isinstance(s, dict)]
    for url in [u for u in urls if isinstance(u, str) and u]:
        parts = [p for p in _url_path(url).split("/") if p]
        best, found = 0, []
        for key, asset in assets.items():
            aparts = Path(key).parts
            n = 0
            while n < min(len(parts), len(aparts)) and parts[-1 - n] == aparts[-1 - n]:
                n += 1
            if n > best:
                best, found = n, [asset]
            elif n == best and n:
                found.append(asset)
        if found:
            return found
    return []


def load_rendered(paths: Sequence[Path]) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            raise ValueError(f"{path}: expected a JSON array from capture_rendered_videos.mjs")
        entries.extend(e for e in data if isinstance(e, dict))
    return entries


def _num(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def assess(asset: Asset, info: Optional[VideoInfo], density: float, detect_silence: bool) -> None:
    """Fill dimensions, risks, recommendations and evidence for one probed asset."""
    rec = asset.recommendations
    rendered_ctrl = any((r.get("attributes") or {}).get("controls") or r.get("inDialog") for r in asset.rendered)
    static_ctrl = any(u.flags.get("controls") for u in asset.usages)
    fullscreen = rendered_ctrl or static_ctrl
    if fullscreen:
        asset.risks.append("fullscreen-possible")
        asset.evidence.append("a usage has controls or a dialog/lightbox context")
    for u in asset.usages:
        if u.flags.get("autoplay") and not u.poster:
            rec.append({"id": "missing-poster", "level": "info",
                        "detail": f"{u.file}:{u.line} autoplays without a poster (first paint shows nothing until data loads)"})
    if info is None:
        asset.proposed_reason = asset.probe_error or "not probed"
        return
    w, h = info.display_width, info.display_height
    if info.width and info.height and info.fps and info.bitrate:
        asset.bits_per_pixel_frame = round(info.bitrate / (info.width * info.height * info.fps), 4)
        limit = BPP_LIMITS.get(info.codec)
        if limit and asset.bits_per_pixel_frame > limit:
            rec.append({"id": "encoding-inefficient", "level": "warn",
                        "detail": f"{asset.bits_per_pixel_frame} bits/pixel/frame exceeds {limit} for {info.codec}"})
    boxes = [(_num(r.get("cssWidth")), _num(r.get("cssHeight"))) for r in asset.rendered]
    asset.proposed_dims, asset.proposed_reason = target_dims(w, h, boxes, density, fullscreen)
    for r in asset.rendered:
        asset.evidence.append(f"rendered {r.get('cssWidth')}x{r.get('cssHeight')} CSS px at viewport "
                              f"{r.get('viewport')} dpr {r.get('devicePixelRatio')} on {r.get('pageUrl')}")
    if asset.proposed_dims and asset.proposed_dims[0] * asset.proposed_dims[1] < w * h:
        ratio = asset.proposed_dims[0] * asset.proposed_dims[1] / float(w * h)
        rec.append({"id": "oversized", "level": "warn",
                    "detail": f"source {w}x{h}, rendered need {asset.proposed_dims[0]}x{asset.proposed_dims[1]}; "
                              f"~{int(asset.bytes * (1 - ratio))} bytes saved ({ESTIMATE_LABEL}, pixel ratio only)"})
    muted = [u.flags.get("muted") for u in asset.usages] + \
        [bool((r.get("attributes") or {}).get("muted")) for r in asset.rendered]
    if info.has_audio and muted and all(m is True for m in muted):
        detail = "audio track present but every usage is muted; confirm audio is not needed before removing it"
        if detect_silence:
            peaks = [audio_max_volume(info.path, stream=i) for i in range(max(1, len(info.audio_streams)))]
            if any(p is None for p in peaks):
                detail += "; peak level not measurable"
            else:
                peak = max(peaks)
                silent = "silent" if peak <= SILENCE_DBFS else "audible"
                detail += f"; loudest track peak {peak} dBFS ({silent}, threshold {SILENCE_DBFS} dBFS)"
        rec.append({"id": "audio-present-all-usages-muted", "level": "info", "detail": detail})


def flag_h264_fallback(assets: Dict[str, Asset]) -> None:
    groups: Dict[str, List[Asset]] = {}
    for asset in assets.values():
        for u in asset.usages:
            if u.element:
                groups.setdefault(u.element, []).append(asset)
    for element, members in groups.items():
        codecs = [(a.probe or {}).get("codec") for a in members]
        if codecs and all(codecs) and "h264" not in codecs:
            for a in {id(a): a for a in members}.values():
                a.recommendations.append({"id": "no-h264-fallback", "level": "warn",
                                          "detail": f"<video> at {element} has only {', '.join(sorted(set(codecs)))} sources"})


def run_audit(root: Path, rendered: Sequence[Dict[str, Any]] = (), density: float = 2.0,
              detect_silence: bool = False, excludes: Sequence[str] = ()) -> Dict[str, Any]:
    """Audit ``root`` read-only and return the report as a dict."""
    root = root.resolve()
    skipped: List[Dict[str, str]] = []
    assets: Dict[str, Asset] = {}
    unresolved: List[Usage] = []
    for path in iter_sources(root, excludes, skipped):
        rel = path.relative_to(root).as_posix()
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            skipped.append({"path": rel, "reason": f"unreadable: {exc}"})
            continue
        for usage in scan_text(rel, text):
            if usage.status == "resolved":
                real, reason = resolve_ref(usage.ref, path, root)
                if real is None:
                    usage.status, usage.reason = "unresolved", reason
                else:
                    usage.asset = real.relative_to(root).as_posix()
                    assets.setdefault(usage.asset, Asset(usage.asset)).usages.append(usage)
                    continue
            unresolved.append(usage)
    probing = ffprobe_available()
    infos: Dict[str, Optional[VideoInfo]] = {}
    by_hash: Dict[str, List[str]] = {}
    for key, asset in sorted(assets.items()):
        real = root / key
        asset.bytes = real.stat().st_size
        asset.sha256 = sha256_file(real)
        by_hash.setdefault(asset.sha256, []).append(key)
        asset.evidence.append(f"{len(asset.usages)} usage(s): " + ", ".join(f"{u.file}:{u.line}" for u in asset.usages))
        infos[key] = None
        if not probing:
            asset.probe_error = "ffprobe unavailable"
            continue
        try:
            infos[key] = probe_video(real)
        except (subprocess.CalledProcessError, OSError, ValueError) as exc:
            asset.probe_error = f"ffprobe failed: {exc.__class__.__name__}"
            continue
        if infos[key] is None:
            asset.probe_error = "no video stream"
        else:
            info = infos[key]
            asset.probe = {k: v for k, v in info.summary().items() if k in (
                "duration", "display_width", "display_height", "width", "height", "codec", "fps", "bitrate",
                "audio_codec", "has_audio", "container", "rotation")}
    for keys in by_hash.values():
        for key in keys:
            assets[key].identical_copies = [k for k in keys if k != key]
    for entry in rendered:
        if entry.get("error"):
            skipped.append({"path": str(entry.get("pageUrl", "")), "reason": f"rendered capture error: {entry['error']}"})
            continue
        matches = match_rendered(entry, assets)
        if not matches:
            skipped.append({"path": str(entry.get("currentSrc") or entry.get("src") or ""),
                            "reason": f"rendered video on {entry.get('pageUrl')} matched no local asset"})
        for asset in matches:
            asset.rendered.append(entry)
    for key, asset in assets.items():
        assess(asset, infos[key], density, detect_silence)
    flag_h264_fallback(assets)
    for u in unresolved:
        u.flags = {k: v for k, v in u.flags.items() if v is not None}
    return {
        "root": str(root), "read_only": True, "density": density, "ffprobe": probing,
        "savings_label": ESTIMATE_LABEL,
        "assets": [asdict(a) for _, a in sorted(assets.items())],
        "not_inspected": [dict(asdict(u), source_confidence="unresolved" if u.status in ("unresolved", "dynamic")
                               else "external") for u in unresolved],
        "skipped": skipped,
    }


def render_markdown(report: Dict[str, Any]) -> str:
    out = [f"# Video usage audit: {report['root']}", "",
           f"Read-only. Density {report['density']}x. ffprobe {'available' if report['ffprobe'] else 'unavailable'}. "
           f"Savings are {report['savings_label']}.", ""]
    for a in report["assets"]:
        p = a["probe"] or {}
        out.append(f"## {a['path']}")
        out.append(f"- bytes: {a['bytes']}; confidence: {a['source_confidence']}")
        if p:
            out.append(f"- {p['display_width']}x{p['display_height']} {p['codec']} {p['fps']:.3g} fps, "
                       f"{p['bitrate']} bit/s, audio: {p['has_audio']}, bpp/frame: {a['bits_per_pixel_frame']}")
        else:
            out.append(f"- probe: {a['probe_error']}")
        if a["identical_copies"]:
            out.append(f"- byte-identical copies: {', '.join(a['identical_copies'])}")
        out.append(f"- proposed dims: {a['proposed_dims']} ({a['proposed_reason']})")
        if a["risks"]:
            out.append(f"- risks: {', '.join(a['risks'])}")
        for r in a["recommendations"]:
            out.append(f"- [{r['level']}] {r['id']}: {r['detail']}")
        for u in a["usages"]:
            flags = ", ".join(k for k, v in u["flags"].items() if v)
            out.append(f"  - {u['file']}:{u['line']} {u['kind']} `{u['ref']}`" + (f" [{flags}]" if flags else ""))
        out.append("")
    if report["not_inspected"]:
        out += ["## Not inspected", ""]
        out += [f"- {u['file']}:{u['line']} `{u['ref']}` ({u['status']}): {u['reason']}" for u in report["not_inspected"]]
        out.append("")
    if report["skipped"]:
        out += ["## Skipped", ""] + [f"- {s['path']}: {s['reason']}" for s in report["skipped"]]
    return "\n".join(out).rstrip() + "\n"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Read-only audit of video usage in a web project.")
    parser.add_argument("root", nargs="?", type=Path, default=Path("."), help="Project root (default: .)")
    parser.add_argument("--rendered", type=Path, action="append", default=[],
                        help="JSON from capture_rendered_videos.mjs (repeatable)")
    parser.add_argument("--density", type=float, default=2.0, help="Pixel density to cover (default: 2.0)")
    parser.add_argument("--json", action="store_true", help="Print the report as JSON")
    parser.add_argument("--detect-silence", action="store_true", help="Measure audio peak of muted-only assets")
    parser.add_argument("--exclude", action="append", default=[], metavar="GLOB", help="Skip matching paths (repeatable)")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.root.is_dir():
        print(f"Error: root is not a directory: {args.root}", file=sys.stderr)
        return 1
    if args.density <= 0:
        print("Error: --density must be positive", file=sys.stderr)
        return 1
    try:
        rendered = load_rendered(args.rendered)
    except (OSError, ValueError) as exc:
        print(f"Error: cannot read rendered data: {exc}", file=sys.stderr)
        return 1
    # Measurement files saved inside the project are inputs, not project sources.
    excludes = list(args.exclude)
    root = args.root.resolve()
    for rendered_path in args.rendered:
        try:
            excludes.append(glob.escape(Path(rendered_path).resolve().relative_to(root).as_posix()))
        except ValueError:
            pass
    report = run_audit(args.root, rendered, args.density, args.detect_silence, excludes)
    print(json.dumps(report, indent=2, default=str) if args.json else render_markdown(report), end="" if not args.json else "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
