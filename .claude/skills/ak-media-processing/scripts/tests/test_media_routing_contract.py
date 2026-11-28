#!/usr/bin/env python3
"""Ownership contract: ak-media-processing is the only owner of video compression.

Composition and motion skills render and hand delivery encoding to this skill;
no other skill ships a compression or web-video audit implementation, and no
duplicate FFmpeg/compress-video skill exists.
"""

import json
import re
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[2]
KITS = SKILL_DIR.parents[2]
OWNER = "ak-media-processing"
OWNED_SCRIPTS = {"video_optimize.py", "video_probe.py", "video_web_audit.py", "capture_rendered_videos.mjs"}


def frontmatter(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"---\n(.*?)\n---\n", text, re.S)
    assert match, f"{path} has no frontmatter"
    return match.group(1)


def all_skill_dirs():
    return [p.parent for p in KITS.glob("*/skills/*/SKILL.md")]


def test_owner_descriptor_covers_web_video():
    meta = frontmatter(SKILL_DIR / "SKILL.md")
    assert re.search(r"^name: ak-media-processing$", meta, re.M)
    when = re.search(r"^when_to_use: (.*)$", meta, re.M).group(1).lower()
    assert "compress" in when and "web video" in when


def test_owner_references_and_scripts_exist():
    body = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
    assert "references/web-video-optimization.md" in body
    for name in OWNED_SCRIPTS:
        assert (SKILL_DIR / "scripts" / name).is_file(), name
    reference = (SKILL_DIR / "references" / "web-video-optimization.md").read_text(encoding="utf-8")
    for script in ("video_optimize.py", "video_web_audit.py", "capture_rendered_videos.mjs"):
        assert script in reference


def test_no_duplicate_compression_skill():
    names = {d.name for d in all_skill_dirs()}
    duplicates = sorted(n for n in names if re.search(r"ffmpeg|compress|video-optim", n))
    assert duplicates == [], f"video compression belongs to {OWNER}: {duplicates}"


def test_no_other_skill_ships_the_implementation():
    offenders = []
    for skill in all_skill_dirs():
        if skill.name == OWNER:
            continue
        offenders += [str(p.relative_to(KITS)) for p in skill.rglob("*") if p.name in OWNED_SCRIPTS]
    assert offenders == []


def test_composition_skills_delegate_delivery_encoding():
    motion_graphics = (KITS / "marketing/skills/ak-motion-graphics/SKILL.md").read_text(encoding="utf-8")
    assert re.search(r"FFmpeg.*encode.*\|\s*`ak-media-processing`", motion_graphics)
    for path in ("core/skills/ak-remotion/SKILL.md", "core/skills/ak-hyperframes/SKILL.md",
                 "marketing/skills/ak-motion-video/references/production-pipeline.md"):
        assert OWNER in (KITS / path).read_text(encoding="utf-8"), path


def test_routing_cases_expect_the_owner_for_compression_prompts():
    cases = json.loads((KITS / "core/skills/ak-skill-creator/assets/semantic-routing/agentkit-engineer-cases.json")
                       .read_text(encoding="utf-8"))["cases"]
    compression = [c for c in cases if re.search(r"\bcompress|encoded larger", c["prompt"], re.I)]
    assert len(compression) >= 3
    assert {c["expected"] for c in compression} == {OWNER}
