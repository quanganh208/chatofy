"""Cổng đo Phase 8: cửa sổ nhỏ nhất, và chồng lấp nhỏ nhất khâu được.

Hai số này kéo ngược nhau. Cửa sổ nhỏ thì giải mã rẻ — đó là cả mục đích của
phase. Nhưng cửa sổ nhỏ cũng để lại ít chồng lấp hơn cho phần khâu, và khâu sai
thì một cụm chữ đã lên màn hình bị nối thêm sai chỗ.

Chạy trên sidecar thật ở :8002, corpus VIVOS (vi) và LibriSpeech (en) đã dùng ở
Phase 1, nên số ở đây so sánh trực tiếp được với `reports/measurement.md`.
"""

import argparse
import io
import json
import os
import statistics
import subprocess
import sys
import time
import uuid
import urllib.request
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
BENCH = Path(os.environ.get("STT_BENCH_ROOT", Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(BENCH))

from stt_bench.manifest import load_manifest  # noqa: E402

STT_URL = os.environ.get("LOCAL_STT_URL", "http://localhost:8002") + "/transcribe"
TTS_URL = os.environ.get("LOCAL_TTS_URL", "http://localhost:8003") + "/synthesize"
BYTES_PER_SECOND = 32000

# Ngưỡng lật của cổng duty: interval = max(300ms, decode * 2), nên một lần giải
# mã đắt hơn ngần này là bắt đầu tự quyết định nhịp thay cho cái sàn.
DECODE_BUDGET_MS = 150.0


def read_pcm(path: Path) -> bytes:
    with wave.open(str(path), "rb") as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1
        return w.readframes(w.getnframes())


def wav_bytes(pcm: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(pcm)
    return buf.getvalue()


def transcribe(pcm: bytes, language: str) -> tuple[str, float]:
    """Một lần giải mã. Trả (text, elapsed_ms)."""
    boundary = uuid.uuid4().hex
    data = b"".join([
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
        f'filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode(),
        wav_bytes(pcm),
        f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="language"'
        f"\r\n\r\n{language}\r\n--{boundary}--\r\n".encode(),
    ])
    req = urllib.request.Request(
        STT_URL, data=data,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    started = time.perf_counter()
    with urllib.request.urlopen(req, timeout=120) as r:
        text = json.loads(r.read())["text"]
    return text, (time.perf_counter() - started) * 1000


import re

_EDGE = re.compile(r"^[^\w]+|[^\w]+$", re.UNICODE)


def norm(token: str) -> str:
    """Dạng dùng ĐỂ SO KHỚP, không phải dạng xuất ra.

    Hai lần đọc khác cửa sổ không bao giờ trùng nhau theo ký tự, vì hai lý do
    không liên quan gì tới nội dung: hậu xử lý viết hoa chữ đầu của MỖI lần đọc
    độc lập, nên `đông` và `Đông` là cùng một âm tiết; và mỗi lần đọc tự thêm dấu
    chấm cuối, nên `hear.` và `hear` cũng vậy.
    """
    return _EDGE.sub("", token).casefold()


def stitch(anchor: list[str], tail: list[str], min_overlap: int,
           max_discard: int = 2) -> list[str] | None:
    """Nối `tail` vào `anchor` tại mối chồng lấp dài nhất tìm được.

    `max_discard` là phần đáng kể. Cửa sổ cắt giữa một từ, nên từ CUỐI của một
    lần đọc thường là một từ cụt: đo được `picturesque` ở lần đọc này và
    `picturesqueness` ở lần đọc sau. Bỏ vài từ cuối của `anchor` trước khi dò
    mối nối là cách xử lý nó — và bỏ được vì `tail` bao giờ cũng nghe được phần
    đó đầy đủ hơn.

    Dò từ mối nối DÀI nhất xuống ngắn nhất, nên chuỗi lặp (`a b a b a b`) chọn
    mối nối dài nhất chứ không phải cái đầu tiên gặp.
    """
    # Cắt HAI đầu, không phải một. Đuôi `anchor` là một từ cụt vì cửa sổ đóng
    # giữa chừng nó; đầu `tail` là một từ cụt vì cửa sổ MỞ giữa chừng nó, và bộ
    # nhận dạng không trả về một từ cụt — nó trả về một từ khác. Đo được `chạy
    # chọt` ở lần đọc này và `Bị chọt` ở lần đọc sau; `gõ cửa phòng` và `Ở
    # phòng`. Chỉ cắt một đầu thì sáu trên mười một ca hỏng vẫn hỏng.
    for lead in range(0, max_discard + 1):
        body = tail[lead:]
        if len(body) < min_overlap:
            break
        nbody = [norm(t) for t in body]
        for discard in range(0, max_discard + 1):
            head = anchor[: len(anchor) - discard] if discard else anchor
            if len(head) < min_overlap:
                break
            nhead = [norm(t) for t in head]
            # j nhỏ nhất = mối nối dài nhất.
            for j in range(max(0, len(head) - len(body)), len(head)):
                k = len(head) - j
                if k < min_overlap:
                    break
                if nhead[j:] == nbody[:k]:
                    return head[:j] + body
    return None


def percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, int(round(q * (len(ordered) - 1))))
    return ordered[idx]


# ── (a) chi phí giải mã theo kích thước cửa sổ ────────────────────────────────

def measure_cost(utterances, language: str, windows: list[float]) -> dict:
    out = {}
    for w in windows:
        need = int(w * BYTES_PER_SECOND)
        samples = []
        for utt in utterances:
            pcm = read_pcm(utt.audio_path)
            if len(pcm) < need:
                continue
            chunk = pcm[-need:]          # cửa sổ trượt đọc phần MỚI nhất
            transcribe(chunk, language)  # warm
            samples.append(transcribe(chunk, language)[1])
        if samples:
            out[w] = {
                "n": len(samples),
                "p50": statistics.median(samples),
                "p95": percentile(samples, 0.95),
            }
    return out


# ── (b) khâu có ổn định không ────────────────────────────────────────────────

def measure_stitch(utterances, language: str, window: float, overlaps: list[float],
                   min_overlaps: list[int], max_discard: int) -> dict:
    """Trượt cửa sổ qua từng clip và thử ghép lại, so với giải mã toàn bộ."""
    grid = {(v, m): {"ok": 0, "wrong": 0, "nojoin": 0, "clips": 0}
            for v in overlaps for m in min_overlaps}

    for utt in utterances:
        pcm = read_pcm(utt.audio_path)
        if len(pcm) < int((window + 0.5) * BYTES_PER_SECOND):
            continue
        truth = transcribe(pcm, language)[0].split()
        if not truth:
            continue

        for v in overlaps:
            step = int((window - v) * BYTES_PER_SECOND)
            if step <= 0:
                continue
            # Từng cửa sổ một, đúng cách đường preview sẽ đọc.
            reads = []
            start = 0
            while True:
                end = min(start + int(window * BYTES_PER_SECOND), len(pcm))
                reads.append(transcribe(pcm[start:end], language)[0].split())
                if end >= len(pcm):
                    break
                start += step

            for m in min_overlaps:
                cell = grid[(v, m)]
                cell["clips"] += 1
                joined = reads[0]
                broke = False
                for nxt in reads[1:]:
                    merged = stitch(joined, nxt, m, max_discard)
                    if merged is None:
                        cell["nojoin"] += 1
                        broke = True
                        break
                    joined = merged
                if broke:
                    continue
                if [norm(t) for t in joined] == [norm(t) for t in truth]:
                    cell["ok"] += 1
                else:
                    cell["wrong"] += 1
    return grid


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--windows", default="2,3,4,5")
    ap.add_argument("--overlaps", default="0.5,1.0,1.5,2.0")
    ap.add_argument("--min-overlaps", default="1,2,3")
    ap.add_argument("--stitch-window", type=float, default=3.0)
    ap.add_argument("--max-discard", type=int, default=2)
    ap.add_argument("--tts-load", action="store_true",
                    help="chạy TTS song song, đúng cảnh câu trước đang được đọc")
    ap.add_argument("--out", default="results/r8-overlap/probe.json")
    a = ap.parse_args()

    windows = [float(x) for x in a.windows.split(",")]
    overlaps = [float(x) for x in a.overlaps.split(",")]
    min_overlaps = [int(x) for x in a.min_overlaps.split(",")]

    load = None
    if a.tts_load:
        load = subprocess.Popen(
            [sys.executable, str(Path(__file__).parent / "tts_load.py")],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        time.sleep(2)

    try:
        report = {"windows": {}, "stitch": {}, "decode_budget_ms": DECODE_BUDGET_MS,
                  "tts_load": a.tts_load, "stitch_window_s": a.stitch_window,
                  "max_discard": a.max_discard}
        for lang, manifest in (("vi", "data/manifest-vi.jsonl"),
                               ("en", "data/manifest-en.jsonl")):
            utts = load_manifest(BENCH / manifest)[: a.limit]
            print(f"\n=== {lang}: {len(utts)} clip ===", flush=True)

            cost = measure_cost(utts, lang, windows)
            report["windows"][lang] = cost
            print(f"{'cửa sổ':>7} {'p50':>7} {'p95':>7}  ngân sách {DECODE_BUDGET_MS:.0f}ms")
            for w, st in cost.items():
                mark = "ĐẠT" if st["p95"] <= DECODE_BUDGET_MS else "VƯỢT"
                print(f"{w:>7.1f} {st['p50']:>6.0f}m {st['p95']:>6.0f}m  {mark}", flush=True)

            grid = measure_stitch(utts, lang, a.stitch_window, overlaps, min_overlaps, a.max_discard)
            report["stitch"][lang] = {f"{v}|{m}": c for (v, m), c in grid.items()}
            print(f"\n{'chồng lấp':>9} {'min_tok':>7} {'clip':>5} {'đúng':>5} "
                  f"{'SAI':>5} {'không nối':>9}")
            for (v, m), c in grid.items():
                print(f"{v:>9.1f} {m:>7} {c['clips']:>5} {c['ok']:>5} "
                      f"{c['wrong']:>5} {c['nojoin']:>9}", flush=True)
    finally:
        if load:
            load.terminate()
            load.wait(timeout=10)

    out = BENCH / a.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"\nghi {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
