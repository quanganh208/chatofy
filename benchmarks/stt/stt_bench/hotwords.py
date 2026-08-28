"""Contextual-biasing hotword list for the vi decode-comparison arm.

The list this module builds is an ORACLE CEILING, not a realistic vocabulary.
It is derived from the test set's own reference texts, so it measures the most
contextual biasing could buy if the rare terms of an utterance were known in
advance. A live conversation does not grant that knowledge; every number
produced with this list must be labelled a ceiling wherever it appears.

Selection rule, deterministic and reproducible from the manifest alone:

1. Vietnamese is written one syllable per token, so a single token is almost
   never a distinctive term — biasing every rare syllable biases half the
   vocabulary. Candidates are adjacent syllable PAIRS.
2. A pair qualifies only when both syllables are corpus hapax (occur exactly
   once across all references). That approximates "rare compound term or proper
   noun" without a Vietnamese POS tagger, and is the reason some selected pairs
   read as grammatical accidents rather than terms.
3. Pairs are taken non-overlapping, scanning each reference left to right, so
   NGỌN LỬA BẠO ĐỘNG yields NGỌN LỬA and BẠO ĐỘNG rather than the straddling
   pair LỬA BẠO.
4. Capped at MAX_HOTWORDS, matching the 48-phrase ceiling of the MT-side
   context block, so one vocabulary list could drive both surfaces.

Phrases are emitted in the model's own casing — the vi BPE vocabulary is
uppercase, and sherpa-onnx encodes hotwords through it at load time.
"""

import collections
import json
from pathlib import Path

#: Mirrors the MT prompt builder's context-block limit so a single vocabulary
#: list can feed both the recognizer and the translation context.
MAX_HOTWORDS = 48


def load_references(manifest_path: Path) -> list[str]:
    with open(manifest_path, encoding="utf-8") as f:
        return [json.loads(line)["ref_text"] for line in f if line.strip()]


def select_hotwords(references: list[str], limit: int = MAX_HOTWORDS) -> list[str]:
    """Non-overlapping adjacent syllable pairs whose syllables are corpus hapax."""
    syllable_counts = collections.Counter(s for ref in references for s in ref.split())

    # No deduplication is needed: a phrase can only be reached twice if both of
    # its syllables occur twice, which makes them non-hapax and disqualifies the
    # pair before it is ever selected. test_hotwords.py pins that property.
    selected: list[str] = []
    for ref in references:
        syllables = ref.split()
        index = 0
        while index + 1 < len(syllables):
            left, right = syllables[index], syllables[index + 1]
            if syllable_counts[left] == 1 and syllable_counts[right] == 1:
                selected.append(f"{left} {right}")
                index += 2  # consume both, so no pair straddles this one
            else:
                index += 1
    return selected[:limit]
