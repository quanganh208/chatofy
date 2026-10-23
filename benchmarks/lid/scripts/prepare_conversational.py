"""Conversational public corpora -> the bench's "real" tier, in sessions.

    uv run --frozen python scripts/prepare_conversational.py

Phase 0's real tier is spontaneous conversation from public corpora (plan
Validation Session 2), fetched by revision + sha256 from
`scripts/conversational_pins.json`:

| Corpus | Language | Becomes |
|---|---|---|
| EdAcc (CC-BY-SA 4.0) | en, video calls; L1 recorded per speaker | en turns; L1 Vietnamese / Mandarin set `accent_l1` (A-ACC) |
| ASCEND (CC-BY-SA 4.0) | zh / en / mixed per utterance, real sessions | zh<->en sessions as recorded; `mixed` dropped (no single label) |
| VietMed (MIT) | vi, health talk show incl. phone callers | vi turns (not `Book`); `rec_condition` gives the channel |
| ViMedCSS (CC-BY-4.0) | vi with English medical terms | vi turns with `codeswitch` (A4) |

No public corpus has a vi<->en conversation, so those sessions are STITCHED
from real turns: one VietMed speaker's turns interleaved, in runs of 1-3, with
one Vietnamese-L1 EdAcc speaker's English turns. Each side keeps one voice, so
the source prior, the voice prior and the "previous turn" fallback are
exercised; turn-taking rhythm and overlap are not. Mono sessions (A9) are one
speaker's consecutive turns. Every clip goes through `lid_bench.clips` like the
public rulers. Writes `data/conversational/manifest.jsonl`.
"""

from __future__ import annotations

import json
import random
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import pyarrow.parquet as pq

BENCH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench import pinned  # noqa: E402
from lid_bench.audio import decode, write_wav  # noqa: E402
from lid_bench.clips import prepare_clip  # noqa: E402
from lid_bench.manifest import Turn, bucket_for, opaque_id, save  # noqa: E402
from lid_bench.sidecar import speech_ms  # noqa: E402

OUT = BENCH_ROOT / "data" / "conversational"
PINS = json.loads((BENCH_ROOT / "scripts" / "conversational_pins.json").read_text())
L1 = {"Vietnamese": "vi", "Mandarin": "zh"}
#: Caps keep one arm-4 run to a couple of hours; every cap samples whole
#: speakers or sessions, never single turns, so sessions stay intact.
EDACC_OTHER_ACCENT_TURNS = 600
VIETMED_TURNS = 1500
VIMEDCSS_TURNS = 600
STITCH_BLOCK = 15
MONO_TURNS = 50
MONO_SESSIONS = 2
#: Short vi turns (A2's <1.5 s bucket) do not exist in any public Vietnamese
#: conversational corpus: VietMed has 6, VietSuperSpeech starts at 3 s. They
#: are made from real VietMed turns by cutting at a real pause after 0.5-1.4 s
#: of speech, and kept apart as `source="vietmed-cut"` so A2 reports them as
#: what they are: fragments of a sentence, not backchannels.
SHORT_VI_TURNS = 150
CUT_FRAME_MS = 20
CUT_MIN_PAUSE_MS = 160
CUT_SPEECH_MS = (500, 1400)


@dataclass
class Raw:
    key: str
    audio: bytes
    lang: str
    source: str
    group: str
    channel: str
    license: str
    speaker: str
    order: int
    session: str | None = None
    accent_l1: str | None = None
    codeswitch: bool = False


def rows(name: str, columns: list[str], splits: tuple[str, ...] | None = None):
    """Rows of a pinned corpus, each tagged with the split its file belongs to."""
    root = pinned.fetch(PINS[name])
    for spec in PINS[name]["files"]:
        split = Path(spec["name"]).name.split("-")[0]
        if splits is not None and split not in splits:
            continue
        for batch in pq.ParquetFile(root / spec["name"]).iter_batches(batch_size=256, columns=columns):
            for row in batch.to_pylist():
                yield {**row, "_split": split}


def edacc() -> list[Raw]:
    out, others = [], []
    for i, r in enumerate(rows("edacc", ["speaker", "l1", "audio"])):
        raw = Raw(key=f"edacc/{i}", audio=r["audio"]["bytes"], lang="en", source="edacc", group="edacc",
                  channel="video-call", license="CC-BY-SA-4.0", speaker=f"edacc:{r['speaker']}", order=i,
                  accent_l1=L1.get(r["l1"]))
        (out if raw.accent_l1 else others).append(raw)
    by_speaker = defaultdict(list)
    for raw in others:
        by_speaker[raw.speaker].append(raw)
    speakers = sorted(by_speaker)
    random.Random("edacc").shuffle(speakers)
    kept: list[Raw] = []
    for speaker in speakers:
        if len(kept) >= EDACC_OTHER_ACCENT_TURNS:
            break
        kept += by_speaker[speaker]
    return out + kept


#: ASCEND conversations are cut into sessions of at most this many turns.
ASCEND_SESSION_TURNS = 40


def ascend() -> list[Raw]:
    """Test + validation. The HF release's `session_id` is 1-4 (a session
    number, not a conversation) and `id` restarts per split, so a conversation
    is a contiguous run of rows sharing (split, topic, session_id), cut into
    sessions of ASCEND_SESSION_TURNS in their recorded order. `mixed` rows are
    dropped but keep their place in the order."""
    out, run_key, run, part = [], None, 0, 0
    for i, r in enumerate(rows("ascend", ["id", "audio", "language", "original_speaker_id", "session_id", "topic"],
                               splits=("test", "validation"))):
        key = (r["_split"], r["topic"], r["session_id"])
        if key != run_key:
            run_key, run, part = key, run + 1, 0
        part += 1
        if r["language"] not in ("en", "zh"):
            continue
        session = f"ascend:{run}:{(part - 1) // ASCEND_SESSION_TURNS}"
        out.append(Raw(key=f"ascend/{r['_split']}/{r['id']}", audio=r["audio"]["bytes"], lang=r["language"],
                       source="ascend", group="ascend", channel="recorded", license="CC-BY-SA-4.0",
                       speaker=f"ascend:{r['original_speaker_id']}", order=i, session=session))
    return out


def vietmed() -> list[Raw]:
    """Talk-show, consultation and phone-in turns; `Book` (read aloud) is not
    conversation and is left out. Sampled by speaker, which in VietMed names a
    recording and a voice (`VietMed_012_b`)."""
    by_speaker = defaultdict(list)
    for i, r in enumerate(rows("vietmed", ["audio", "utterance_id", "speaker_name", "rec_condition"])):
        if r["rec_condition"] == "Book":
            continue
        channel = "phone" if r["rec_condition"] == "Tel" else "broadcast"
        by_speaker[r["speaker_name"]].append(Raw(
            key=f"vietmed/{r['utterance_id']}", audio=r["audio"]["bytes"], lang="vi", source="vietmed",
            group="vietmed", channel=channel, license="MIT", speaker=f"vietmed:{r['speaker_name']}", order=i))
    speakers = sorted(by_speaker)
    random.Random("vietmed").shuffle(speakers)
    kept: list[Raw] = []
    for speaker in speakers:
        if len(kept) >= VIETMED_TURNS:
            break
        kept += by_speaker[speaker]
    return kept


def vimedcss() -> list[Raw]:
    out = [Raw(key=f"vimedcss/{r['segment_id']}", audio=r["audio"]["bytes"], lang="vi", source="vimedcss",
               group="vimedcss", channel="broadcast", license="CC-BY-4.0", speaker="vimedcss", order=i,
               codeswitch=True)
           for i, r in enumerate(rows("vimedcss", ["segment_id", "audio"]))]
    return random.Random("vimedcss").sample(out, min(VIMEDCSS_TURNS, len(out)))


def sessions(vi: list[Raw], en_vi_l1: list[Raw], other_en: list[Raw]) -> tuple[list[tuple[str, list[Raw], str | None, bool]], set[str]]:
    """(session, ordered turns, declared source, mono) for stitched and mono
    sessions, plus the keys they used."""
    rng = random.Random("sessions")
    out: list[tuple[str, list[Raw], str | None, bool]] = []
    used: set[str] = set()

    def by_speaker(raws):
        groups = defaultdict(list)
        for raw in sorted(raws, key=lambda r: r.order):
            groups[raw.speaker].append(raw)
        return dict(sorted(groups.items(), key=lambda kv: -len(kv[1])))

    vi_speakers, en_speakers = by_speaker(vi), by_speaker(en_vi_l1)
    # Mono first, from the speakers with most turns: one person, one language.
    for lang, pool in (("vi", vi_speakers), ("en", by_speaker(other_en))):
        for speaker, turns in list(pool.items())[:MONO_SESSIONS]:
            if len(turns) >= MONO_TURNS:
                chosen = turns[:MONO_TURNS]
                out.append((f"mono:{lang}:{speaker}", chosen, None, True))
                used |= {t.key for t in chosen}

    def blocks(pool):
        for speaker, turns in pool.items():
            free = [t for t in turns if t.key not in used]
            for start in range(0, len(free), STITCH_BLOCK):
                yield free[start:start + STITCH_BLOCK]

    vi_blocks, en_blocks = list(blocks(vi_speakers)), list(blocks(en_speakers))
    for index, (a, b) in enumerate(zip(vi_blocks, en_blocks)):
        start = rng.choice(("vi", "en"))
        queues = {"vi": list(a), "en": list(b)}
        side, ordered = start, []
        while queues["vi"] or queues["en"]:
            if not queues[side]:
                side = "en" if side == "vi" else "vi"
            run = rng.randint(1, 3)
            ordered += queues[side][:run]
            del queues[side][:run]
            side = "en" if side == "vi" else "vi"
        # The first speaker is the one who picked the source in the picker.
        out.append((f"stitched:{index}", ordered, start, False))
        used |= {t.key for t in ordered}
    return out, used


def cut_at_pause(samples):
    """`samples` up to the middle of the first real pause after CUT_SPEECH_MS[0]
    of speech and before CUT_SPEECH_MS[1], or None when there is none."""
    import numpy as np

    from lid_bench.clips import ONSET_LEVEL

    frame = 16000 * CUT_FRAME_MS // 1000
    usable = samples.size - samples.size % frame
    loud = np.sqrt(np.square(samples[:usable].reshape(-1, frame)).mean(axis=1)) > ONSET_LEVEL
    need = CUT_MIN_PAUSE_MS // CUT_FRAME_MS
    spoken, quiet = 0, 0
    for index, is_speech in enumerate(loud):
        if is_speech:
            if quiet >= need and CUT_SPEECH_MS[0] <= spoken * CUT_FRAME_MS:
                end = (index - quiet // 2) * frame
                return samples[:end]
            spoken, quiet = spoken + 1, 0
            if spoken * CUT_FRAME_MS > CUT_SPEECH_MS[1]:
                return None
        elif spoken:
            quiet += 1
    return None


def short_vi(raws: list[Raw]) -> list[Turn]:
    out = []
    for raw in random.Random("short-vi").sample(raws, len(raws)):
        if len(out) >= SHORT_VI_TURNS:
            break
        cut = cut_at_pause(prepare_clip(decode(raw.audio)))
        if cut is None:
            continue
        measured = speech_ms(cut)
        if not 300 <= measured < 1500:
            continue
        turn_id = opaque_id("vietmed-cut", raw.key)
        path = OUT / "vietmed-cut" / f"{turn_id}.wav"
        write_wav(path, cut)
        out.append(Turn(id=turn_id, audio=path.relative_to(BENCH_ROOT).as_posix(), lang="vi",
                        bucket=bucket_for(measured), speech_ms=measured, channel=raw.channel, group="vietmed",
                        source="vietmed-cut", real=True, license=raw.license, speaker=raw.speaker))
    return out


def to_turn(raw: Raw, session: str | None, order: int | None, declared: str | None, mono: bool) -> Turn:
    samples = prepare_clip(decode(raw.audio))
    turn_id = opaque_id(raw.source, raw.key)
    path = OUT / raw.source / f"{turn_id}.wav"
    write_wav(path, samples)
    measured = speech_ms(samples)
    return Turn(id=turn_id, audio=path.relative_to(BENCH_ROOT).as_posix(), lang=raw.lang,
                bucket=bucket_for(measured), speech_ms=measured, channel=raw.channel, group=raw.group,
                source=raw.source, real=True, license=raw.license,
                session=None if session is None else opaque_id("session", session), order=order,
                speaker=raw.speaker, codeswitch=raw.codeswitch, accent_l1=raw.accent_l1,
                declared_source=declared, mono=mono)


def main() -> int:
    en = edacc()
    zh_en = ascend()
    vi = vietmed()
    cs = vimedcss()
    en_vi_l1 = [r for r in en if r.accent_l1 == "vi"]
    other_en = [r for r in en if r.accent_l1 != "vi"]
    built, used = sessions(vi, en_vi_l1, other_en)

    turns: list[Turn] = []
    for session, ordered, declared, mono in built:
        turns += [to_turn(raw, session, i, declared, mono) for i, raw in enumerate(ordered)]
    by_session = defaultdict(list)
    for raw in zh_en:
        by_session[raw.session].append(raw)
    for session, members in sorted(by_session.items()):
        turns += [to_turn(raw, session, i, None, False) for i, raw in enumerate(sorted(members, key=lambda r: r.order))]
    leftovers = [r for r in vi + en if r.key not in used] + cs
    turns += [to_turn(raw, None, None, None, False) for raw in leftovers]
    # Cut only from VietMed turns outside every session, so a session's own
    # turns are never also scored as fragments.
    turns += short_vi([r for r in vi if r.key not in used])
    save(OUT / "manifest.jsonl", turns)
    counts = defaultdict(int)
    for t in turns:
        counts[(t.source, t.lang)] += 1
    print(f"wrote {len(turns)} turns: {dict(sorted(counts.items()))}")
    print(f"sessions: {sum(1 for s in built if not s[3])} stitched vi<->en, {sum(1 for s in built if s[3])} mono, "
          f"{len(by_session)} ASCEND")
    return 0


if __name__ == "__main__":
    sys.exit(main())
