"""Render the panel result as markdown.

The report states the exclusions and the separation verdict, not just the means.
A MOS with no n, no exclusion count, and no interval is three numbers a reader
has to take on trust.
"""

ICC_BANDS = ((0.90, "excellent"), (0.75, "good"), (0.50, "moderate"), (0.0, "poor"))


def _icc_label(value: float) -> str:
    for threshold, label in ICC_BANDS:
        if value >= threshold:
            return label
    return "poor"


def _panel_section(screens: list, keep: set[str], tolerance: int, include_flagged: bool) -> list[str]:
    flagged = [s for s in screens if not s.passed]
    lines = [
        "## Panel",
        "",
        f"- Returned: {len(screens)} listener(s)",
        f"- Retained: {len(keep)}",
        f"- Flagged: {len(flagged)}"
        + (" (scored anyway, --include-flagged)" if include_flagged and flagged else ""),
        f"- Attention-check tolerance: repeat ratings may differ by at most {tolerance}",
        "",
    ]
    if not flagged:
        lines += ["No listener triggered a screening flag.", ""]
        return lines
    lines += [
        "| Listener | Flags | Max repeat gap | Rating SD | Ratings |",
        "|---|---|---|---|---|",
    ]
    for screen in sorted(flagged, key=lambda s: s.listener_id):
        gap = "n/a" if screen.max_repeat_gap is None else f"{screen.max_repeat_gap:.0f}"
        lines.append(
            f"| {screen.listener_id} | {', '.join(screen.flags)} | {gap} "
            f"| {screen.rating_sd:.2f} | {screen.n_ratings} |"
        )
    lines.append("")
    return lines


def _separation_note(rows: list[dict], lang: str) -> str:
    """Whether the top two systems' intervals actually come apart."""
    ranked = sorted(
        (r for r in rows if r["lang"] == lang and r["n_listeners"] > 1),
        key=lambda r: r["mos"],
        reverse=True,
    )
    if len(ranked) < 2:
        return ""
    best, runner_up = ranked[0], ranked[1]
    best_low = best["mos"] - best["ci95"]
    runner_high = runner_up["mos"] + runner_up["ci95"]
    if best_low > runner_high:
        return (
            f"`{best['system']}` is ahead of `{runner_up['system']}` with"
            " non-overlapping 95% intervals."
        )
    return (
        f"`{best['system']}` scores higher than `{runner_up['system']}`, but their 95%"
        " intervals overlap — this panel does not separate them. Report it as a tie"
        " or add listeners."
    )


def render_report(
    rows: list[dict],
    screens: list,
    keep: set[str],
    icc_by_lang: dict[str, dict],
    attention_tolerance: int,
    include_flagged: bool,
) -> str:
    out = [
        "# Mini-MOS Listening Panel Results",
        "",
        "Naturalness only, 5-point scale, blinded and within-subjects.",
        "",
    ]
    out += _panel_section(screens, keep, attention_tolerance, include_flagged)

    for lang in sorted({row["lang"] for row in rows}):
        lang_rows = sorted(
            (r for r in rows if r["lang"] == lang), key=lambda r: r["mos"], reverse=True
        )
        out += [f"## MOS — {lang}", "", "| System | MOS | 95% CI | Listeners |", "|---|---|---|---|"]
        for row in lang_rows:
            ci = "n/a" if row["n_listeners"] < 2 else f"± {row['ci95']:.2f}"
            out.append(
                f"| {row['system']} | {row['mos']:.2f} | {ci} | {row['n_listeners']} |"
            )
        out.append("")
        note = _separation_note(rows, lang)
        if note:
            out += [note, ""]

        icc = icc_by_lang.get(lang, {})
        if "error" in icc:
            out += [f"Inter-rater agreement not computed: {icc['error']}", ""]
        elif icc:
            out += [
                f"Inter-rater agreement: ICC(2,1) = {icc['icc_2_1']:.3f}"
                f" ({_icc_label(icc['icc_2_1'])} for a single listener),"
                f" ICC(2,k) = {icc['icc_2_k']:.3f}"
                f" ({_icc_label(icc['icc_2_k'])} for the panel mean),"
                f" over {icc['n_clips']} clips x {icc['n_listeners']} listeners.",
                "",
            ]

    out += [
        "## Notes",
        "",
        "- The interval is computed over per-listener means, so n is the number of"
        " listeners, not the number of ratings. One listener's ratings are correlated"
        " with each other and do not count as independent observations.",
        "- Only the first presentation of a clip enters the MOS. Repeats exist to screen"
        " listeners and would otherwise double-weight whichever clips were drawn.",
        "- Listeners rate naturalness of the audio. Adequacy is scored separately on"
        " transcripts, so voice preference cannot leak into the adequacy number.",
        "",
    ]
    return "\n".join(out)
