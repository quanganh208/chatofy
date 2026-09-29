"""CLI: convert an ElevenLabs Scribe v2 raw transcript into the `ref.json` shape.

Usage: scribe_to_ref.py <scribe.json> <out ref.json>
"""
import json
import sys
from pathlib import Path

BENCH = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BENCH))
from stt_bench.scribe_reference import reference_words, to_ref_segments

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"usage: {sys.argv[0]} <scribe.json> <out ref.json>", file=sys.stderr)
        sys.exit(1)
    scribe = json.load(open(sys.argv[1]))
    segments = to_ref_segments(reference_words(scribe))
    json.dump(segments, open(sys.argv[2], "w"), ensure_ascii=False)
    print(f"{sys.argv[2]}: {len(segments)} segments, {sum(len(s['words']) for s in segments)} words")
