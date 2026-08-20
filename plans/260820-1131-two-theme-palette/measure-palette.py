#!/usr/bin/env python3
"""Measures the candidate palettes: WCAG contrast for every pair in use, hue distance
for every pair distinguished by colour.

Run: python3 plans/260820-1131-two-theme-palette/measure-palette.py

The pairs are listed rather than generated. A generated cross-product measures
hundreds of combinations nobody renders and buries the handful that matter; every row
below is a pairing that appears in `globals.css`, `popup/styles.ts` or the mock.
"""
import colorsys
import sys

LIGHT = {
    "bg": "#FCFCFB",
    "surface": "#FFFFFF",
    "surfaceRaised": "#F4F4F1",
    "border": "#E4E4E0",
    "borderStrong": "#B5B5AB",
    "borderControl": "#8D8D85",
    "text": "#131313",
    "textSecondary": "#4A4A46",
    "textMuted": "#6F6F6A",
    "accent": "#2F4CE0",
    "accentHover": "#2439C4",
    "accentText": "#2740CC",
    "accentSubtle": "#ECEFFD",
    "onAccent": "#FFFFFF",
    "onLiveFill": "#FFFFFF",
    "live": "#B3291D",
    "liveFill": "#B32E23",
    "liveSubtle": "#FBEAE8",
    "speaking": "#0F6B3E",
    "warning": "#7A4E00",
    "warningSubtle": "#FBF0D8",
}

DARK = {
    "bg": "#111214",
    "surface": "#191B1E",
    "surfaceRaised": "#212429",
    "border": "#292C31",
    "borderStrong": "#43484E",
    "borderControl": "#696E76",
    "text": "#F0F0EE",
    "textSecondary": "#B4B6B2",
    "textMuted": "#8A8D8A",
    "accent": "#7A90F5",
    "accentHover": "#93A5F8",
    "accentText": "#A3B4F9",
    "accentSubtle": "#1B2140",
    "onAccent": "#0B1030",
    "onLiveFill": "#FFFFFF",
    "live": "#E9635A",
    "liveFill": "#C9433A",
    "liveSubtle": "#3A1B18",
    "speaking": "#45B97C",
    "warning": "#E9A23B",
    "warningSubtle": "#3A2A0C",
}

# (foreground, background, minimum, what it is)
PAIRS = [
    ("text", "bg", 4.5, "body on the page"),
    ("text", "surface", 4.5, "body on a card"),
    ("text", "surfaceRaised", 4.5, "body on a control"),
    ("textSecondary", "bg", 4.5, "supporting prose"),
    ("textSecondary", "surface", 4.5, "supporting prose on a card"),
    ("textMuted", "bg", 4.5, "hints and labels"),
    ("textMuted", "surface", 4.5, "hints on a card"),
    ("accentText", "bg", 4.5, "accent used as text"),
    ("accentText", "surface", 4.5, "accent as text on a card"),
    ("onAccent", "accent", 4.5, "label on the primary button"),
    ("onAccent", "accentHover", 4.5, "label on the primary button, hovered"),
    ("accentText", "accentSubtle", 4.5, "accent text on its own tint"),
    ("onLiveFill", "liveFill", 4.5, "label on the stop button"),
    ("live", "bg", 4.5, "recording text"),
    ("live", "surface", 4.5, "recording text on a card"),
    ("speaking", "bg", 4.5, "speaking text"),
    ("warning", "warningSubtle", 4.5, "warning text on its own tint"),
    ("text", "warningSubtle", 4.5, "body inside a warning notice"),
    ("text", "liveSubtle", 4.5, "body inside an error notice"),
    # 3:1 is WCAG 1.4.11's floor for the visual boundary of a user interface
    # component. It applies to a control outline and not to a divider — and the
    # difference is a real distinction in the spec, not a threshold lowered because
    # it failed. Dividers still carry a floor of their own, because this direction
    # separates surfaces with rules instead of luminance steps: an invisible rule
    # takes the mechanism with it.
    ("borderControl", "surface", 3.0, "control outline — WCAG 1.4.11"),
    ("borderControl", "surfaceRaised", 3.0, "control outline on a raised control"),
    ("borderStrong", "bg", 2.0, "emphasised divider — visible, not a boundary"),
    ("border", "bg", 1.2, "hairline between surfaces"),
]

# Pairs a reader must tell apart. The labelling rule covers meaning; this covers the
# case where two states sit side by side and only the hue differs.
HUES = [
    ("accent", "speaking", 60),
    ("live", "speaking", 60),
    ("accent", "live", 60),
    ("warning", "live", 25),
]


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))


def luminance(h):
    def channel(v):
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(c) for c in rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def hue(h):
    r, g, b = rgb(h)
    return colorsys.rgb_to_hls(r, g, b)[0] * 360


def hue_gap(a, b):
    d = abs(hue(a) - hue(b))
    return min(d, 360 - d)


def report(name, palette):
    print(f"\n{'=' * 66}\n{name}\n{'=' * 66}")
    failures = []
    for fg, bg, floor, what in PAIRS:
        ratio = contrast(palette[fg], palette[bg])
        ok = ratio >= floor
        if not ok:
            failures.append(f"{name}: {fg} on {bg} = {ratio:.2f} (need {floor})")
        print(f"  {'ok ' if ok else 'FAIL'} {ratio:5.2f}:1  {fg} on {bg:<14} — {what}")
    print("  " + "-" * 62)
    for a, b, floor in HUES:
        gap = hue_gap(palette[a], palette[b])
        ok = gap >= floor
        if not ok:
            failures.append(f"{name}: {a} vs {b} = {gap:.1f}deg (need {floor})")
        print(f"  {'ok ' if ok else 'FAIL'} {gap:5.1f}°    {a} vs {b} (need {floor}°)")
    return failures


def main():
    missing = set(LIGHT) ^ set(DARK)
    if missing:
        sys.exit(f"palettes disagree on keys: {sorted(missing)}")
    failures = report("LIGHT", LIGHT) + report("DARK", DARK)
    print()
    if failures:
        print(f"{len(failures)} failing:")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print(f"all {len(PAIRS) * 2 + len(HUES) * 2} checks pass across both palettes")


if __name__ == "__main__":
    main()
