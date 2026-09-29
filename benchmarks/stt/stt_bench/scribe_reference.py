"""Turn an ElevenLabs Scribe v2 raw transcript into an oracle-segment reference.

Scribe v2's word list mixes real spoken words with `audio_event` entries
(`[nhạc nền]`, `[tiếng cười]`, `[hiệu ứng âm thanh]`, ...) and `spacing`
tokens, and those event tags also show up inside its flattened `text` field.
Left in, they get charged as recognizer errors: on conversation 1cd04a39,
scoring prod against Scribe with tags left in reads 15.3% WER instead of
8.6% (see plans/reports/brainstorm-260929-1006-vietnamese-stt-ruler-audit.md).
"""

from typing import Any


def reference_words(scribe: dict[str, Any]) -> list[tuple[float, float, str]]:
    """Keep only real spoken words from a Scribe v2 raw transcript.

    Drops `spacing` and `audio_event` entries, and — defensively, in case a
    future Scribe response ever embeds a bracket tag as `type == "word"` —
    drops any word whose own text is itself a bracket tag.
    """
    words = []
    for w in scribe.get("words", []):
        if w.get("type") != "word":
            continue
        text = w["text"].strip()
        if not text or (text.startswith("[") and text.endswith("]")):
            continue
        words.append((w["start"], w["end"], text))
    return words


def to_ref_segments(
    words: list[tuple[float, float, str]], gap: float = 0.3, max_s: float = 8.0
) -> list[dict[str, Any]]:
    """Group a flat word list into the `ref.json` shape.

    Splits on the same rule `oracle_segments.segments()` uses to find turn
    boundaries (a >= gap silence, or the max_s cap) so the segmentation this
    reference implies matches what oracle scoring later pads and slices.
    Unlike `oracle_segments.segments()`, this keeps `text` and `words` per
    segment, since it feeds `score.py` (which reads `text`) and
    `prod_arms.py`/`segments()` (which reads `words`), not audio slicing.
    """
    grouped: list[list[tuple[float, float, str]]] = []
    current: list[tuple[float, float, str]] = []
    for start, end, text in words:
        if current and (start - current[-1][1] >= gap or end - current[0][0] > max_s):
            grouped.append(current)
            current = []
        current.append((start, end, text))
    if current:
        grouped.append(current)

    return [
        {
            "start": seg[0][0],
            "end": seg[-1][1],
            "text": " ".join(w for _, _, w in seg),
            "words": [[start, end, w] for start, end, w in seg],
        }
        for seg in grouped
    ]
