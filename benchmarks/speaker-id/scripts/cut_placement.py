"""Where a forced turn cut lands, against the Scribe transcript it was cut on.

`SpeechGate`'s length ceiling forces a turn closed when the speaker never
pauses; on broadcast audio with a music bed, most speech-branch blocks never
drop under the noise floor, so the ceiling is the ONLY thing that ends the
turn — always at the same wall-clock distance from where it opened, landing
wherever the speaker happened to be. Any rule meant to move these cuts earlier,
onto a syllable gap the bed hides from the absolute pause rule, is checked here
against real recordings instead of read off a diff.

Two things distinguish where a forced cut is coming from, independent of each
other:

* **ceiling vs lookahead** — did the cut fire because the turn's wall time hit
  `max_utterance_ms` with nowhere quiet found (the fallback a better cut rule
  exists to shrink), or did some rule inside the lookahead window close it early?
* **inside_token / phrase_safe / neither** — where the cut LANDS relative to
  the Scribe transcript. Scribe `word` entries for Vietnamese are syllables
  (no token contains a space), so "inside a word" here means inside a syllable — the
  finest thing the transcript can see. `phrase_safe` needs a real gap (>=150ms)
  around the cut or a token ending on punctuation; anything else is `neither`
  — landing between two syllables of what both ports treat as one lexical
  item, e.g. "Việt | Nam".

This drives the REAL production gate over each recording via
`scripts/gate-reference.mjs`, never `speaker_bench.segment`'s port — the port
is what is being changed and verified elsewhere (`tests/test_segment_parity.py`);
using it here to judge itself would prove nothing.

Usage:
    uv run python scripts/cut_placement.py rulers/conversations
    uv run python scripts/cut_placement.py rulers/conversations --out rulers/conversations/cuts-shipped.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
BENCH_ROOT = HERE.parent
REPO_ROOT = BENCH_ROOT.parent.parent
GATE_REFERENCE = HERE / "gate-reference.mjs"

#: Matches the web app's continuous capture (`capture-pump.ts`'s `continuous`
#: option), which is what every one of these recordings was captured under.
DEFAULT_MAX_UTTERANCE_MS = 8000.0

#: Scribe inter-token gap, or gap either side of a cut, that counts as a real
#: pause rather than a dip inside connected speech. The
#: phrase-level measure, independent of `CUT_MIN_QUIET_MS` in the gate
#: itself — that constant is about what the GATE waits for, this is about what
#: the TRANSCRIPT shows around wherever the gate actually cut.
PHRASE_SAFE_GAP_MS = 150.0

#: Trailing characters that make the token before a cut a sentence/clause
#: boundary even without a 150ms Scribe gap (Scribe times are per-syllable and
#: often abut across a comma).
_PUNCTUATION = ".,!?;:…"


@dataclass(frozen=True)
class ScribeToken:
    text: str
    start_ms: float
    end_ms: float


def load_scribe_tokens(scribe_path: Path) -> list[ScribeToken]:
    """`type == "word"` entries only.

    `audio_event` (`[tiếng hít vào]`) and `spacing` entries carry no lexical
    content; counting a cut landing inside one of those as `inside_token`
    would blame the gate for clipping silence.
    """
    data = json.loads(scribe_path.read_text())
    tokens = [
        ScribeToken(text=w["text"], start_ms=w["start"] * 1000.0, end_ms=w["end"] * 1000.0)
        for w in data["words"]
        if w["type"] == "word"
    ]
    tokens.sort(key=lambda t: t.start_ms)
    return tokens


def classify_cut(cut_ms: float, tokens: list[ScribeToken]) -> str:
    """`"inside_token"`, `"phrase_safe"` or `"neither"` for one cut timestamp."""
    for token in tokens:
        if token.start_ms < cut_ms < token.end_ms:
            return "inside_token"

    prev_end: float | None = None
    prev_text: str | None = None
    next_start: float | None = None
    for token in tokens:
        if token.end_ms <= cut_ms:
            prev_end = token.end_ms
            prev_text = token.text
        elif next_start is None and token.start_ms >= cut_ms:
            next_start = token.start_ms

    # A cut before the first token or after the last has nothing to clip.
    if prev_end is None or next_start is None:
        return "phrase_safe"
    if next_start - prev_end >= PHRASE_SAFE_GAP_MS:
        return "phrase_safe"
    if prev_text and prev_text[-1] in _PUNCTUATION:
        return "phrase_safe"
    return "neither"


@dataclass(frozen=True)
class ForcedCut:
    at_ms: float
    block_index: int
    #: "ceiling" or "lookahead" — see the module docstring.
    turn_class: str
    #: "inside_token", "phrase_safe" or "neither" — see the module docstring.
    content_class: str


def forced_cuts(gate_output: dict, tokens: list[ScribeToken]) -> list[ForcedCut]:
    """Walk one `gate-reference.mjs` run's events and classify each forced cut.

    A forced cut is `ceiling` when the open turn had already run
    `max_utterance_ms - block_ms` or more by the block that closed it — the
    earliest block the ceiling check itself could fire on — and `lookahead`
    otherwise: some rule inside the lookahead window (the 100ms absolute pause,
    or any other in-window rule) closed it before the
    ceiling had to.
    """
    block_ms = gate_output["blockMs"]
    max_utterance_ms = gate_output["maxUtteranceMs"]
    cuts: list[ForcedCut] = []
    open_start: int | None = None
    for event in gate_output["events"]:
        if event["type"] == "start":
            open_start = event["blockIndex"]
        elif event["type"] == "end":
            if event.get("reason") == "forced" and open_start is not None:
                utterance_ms = (event["blockIndex"] - open_start + 1) * block_ms
                turn_class = "ceiling" if utterance_ms >= max_utterance_ms - block_ms else "lookahead"
                cuts.append(
                    ForcedCut(
                        at_ms=event["atMs"],
                        block_index=event["blockIndex"],
                        turn_class=turn_class,
                        content_class=classify_cut(event["atMs"], tokens),
                    )
                )
            open_start = None
    return cuts


def run_gate_reference(
    wav: Path, *, max_utterance_ms: float, resume_after_cut: bool = True, node: str = "node"
) -> dict:
    """Drive the real TypeScript `SpeechGate` over `wav` and parse its JSON."""
    command = [
        node,
        str(GATE_REFERENCE),
        # Absolute: the subprocess runs with cwd=REPO_ROOT for pnpm/esbuild to
        # resolve, so a path relative to the caller's own cwd would miss.
        str(wav.resolve()),
        "--max-utterance-ms",
        str(int(max_utterance_ms)),
    ]
    if resume_after_cut:
        command.append("--resume-after-cut")
    result = subprocess.run(command, capture_output=True, text=True, cwd=REPO_ROOT)
    if result.returncode != 0:
        raise RuntimeError(f"gate-reference.mjs failed on {wav.name}: {result.stderr.strip()[:500]}")
    return json.loads(result.stdout)


def sessions(directory: Path) -> list[tuple[str, Path, Path]]:
    """`(session_id, wav, scribe_json)` triples with both files present."""
    found = []
    for wav in sorted(directory.glob("*.wav")):
        session_id = wav.stem
        scribe = directory / f"{session_id}.scribe.json"
        if scribe.exists():
            found.append((session_id, wav, scribe))
    return found


def summarize(cuts: list[ForcedCut]) -> dict[str, int]:
    return {
        "forced": len(cuts),
        "ceiling": sum(1 for c in cuts if c.turn_class == "ceiling"),
        "lookahead": sum(1 for c in cuts if c.turn_class == "lookahead"),
        "inside_token": sum(1 for c in cuts if c.content_class == "inside_token"),
        "phrase_safe": sum(1 for c in cuts if c.content_class == "phrase_safe"),
        "neither": sum(1 for c in cuts if c.content_class == "neither"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="rulers/conversations, or another dir of <id>.wav + <id>.scribe.json")
    parser.add_argument("--max-utterance-ms", type=float, default=DEFAULT_MAX_UTTERANCE_MS)
    parser.add_argument(
        "--no-resume-after-cut",
        action="store_true",
        help="Disable resumeAfterCut (off by default in the plain, non-continuous gate).",
    )
    parser.add_argument("--out", type=Path, help="Write per-session cut times and classes to this JSON file.")
    parser.add_argument("--node", default="node")
    args = parser.parse_args()

    found = sessions(args.directory)
    if not found:
        print(f"no <id>.wav + <id>.scribe.json pairs under {args.directory}", file=sys.stderr)
        return 1

    per_session: dict[str, list[ForcedCut]] = {}
    for session_id, wav, scribe in found:
        gate_output = run_gate_reference(
            wav,
            max_utterance_ms=args.max_utterance_ms,
            resume_after_cut=not args.no_resume_after_cut,
            node=args.node,
        )
        tokens = load_scribe_tokens(scribe)
        cuts = forced_cuts(gate_output, tokens)
        per_session[session_id] = cuts

        counts = summarize(cuts)
        print(
            f"{session_id}: {counts['forced']} forced "
            f"({counts['ceiling']} ceiling / {counts['lookahead']} lookahead) — "
            f"inside_token {counts['inside_token']}, phrase_safe {counts['phrase_safe']}, "
            f"neither {counts['neither']}"
        )

    all_cuts = [cut for cuts in per_session.values() for cut in cuts]
    totals = summarize(all_cuts)
    print(
        f"TOTAL: {totals['forced']} forced "
        f"({totals['ceiling']} ceiling / {totals['lookahead']} lookahead) — "
        f"inside_token {totals['inside_token']}, phrase_safe {totals['phrase_safe']}, "
        f"neither {totals['neither']}"
    )

    if args.out:
        payload = {
            "max_utterance_ms": args.max_utterance_ms,
            "resume_after_cut": not args.no_resume_after_cut,
            "sessions": {
                session_id: [asdict(cut) for cut in cuts] for session_id, cuts in per_session.items()
            },
        }
        args.out.write_text(json.dumps(payload, indent=2) + "\n")
        print(f"wrote {args.out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
