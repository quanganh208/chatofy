"""Đo xem tiền tố của bộ nhận dạng có ổn định đủ để CHỐT chữ hay không.

Các arm khác trong thư mục này hỏi "bản cuối đúng không" và "màn hình nhấp nháy
bao nhiêu". Script này hỏi một câu khác: nếu ta chỉ hiển thị phần mà hai lần giải
mã liên tiếp đã ĐỒNG Ý với nhau, thì phần đó lớn lên nhanh chừng nào, và có bao
giờ đứng im giữa câu không.

Vì sao gọi qua HTTP thay vì nạp model in-process: cổng duty của production chia
theo thời gian decode đo start-to-settle, và thời gian đó gồm cả transport lẫn
chờ lane của sidecar. Đo in-process cho ra nhịp đẹp hơn thứ người dùng thật gặp.
"""
import argparse
import io
import json
import math
import os
import sys
import time
import unicodedata
from pathlib import Path

import numpy as np
import requests
import soundfile as sf

sys.path.insert(0, str(Path(__file__).parent))
from stream_metrics import lcp  # noqa: E402

BENCH = Path(os.environ.get("STT_BENCH_ROOT", Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(BENCH))
from stt_bench.manifest import load_manifest  # noqa: E402

SR = 16_000

# Ba hằng dưới đây không phải lựa chọn của script — chúng là giá trị production
# đang chạy. Đổi chúng ở đây mà không đổi ở đó thì phép đo mất nghĩa.
FEED_MS = 300  # partial-transcript-scheduler.ts DEFAULT_CADENCE_MS
MIN_AUDIO_MS = 200  # partial-transcript-scheduler.ts MIN_AUDIO_MS
PRE_ROLL_MS = 320  # capture-pump.ts PRE_ROLL_MS — lượt thật luôn mở kèm pre-roll


def _pct(values: list[float], q: float) -> float | None:
    """Nearest-rank, để p95 của một mẫu nhỏ vẫn là một giá trị có thật."""
    if not values:
        return None
    s = sorted(values)
    idx = min(len(s) - 1, max(0, math.ceil(q * len(s)) - 1))
    return round(s[idx], 4)


def _fold_tone(token: str) -> str:
    """Bỏ mọi dấu kết hợp để hai cách viết chỉ khác dấu trở nên bằng nhau.

    Đây là phép so RỘNG HƠN dấu thanh: nó cũng gộp ă/â/ê/ô/ơ/ư về nguyên âm
    trần. Nên con số đếm được là CẬN TRÊN của số lần sửa dấu thanh, và báo cáo
    phải nói vậy thay vì để người đọc tưởng là số chính xác.
    """
    return "".join(
        c for c in unicodedata.normalize("NFD", token.lower()) if not unicodedata.combining(c)
    )


def _adjacent_duplications(text: str) -> int:
    """Đếm số cụm >= 2 âm tiết bị lặp liền kề trong một chuỗi.

    Tách hẳn khỏi phép đếm sửa dấu: r5 có ca VIVOSDEV13_089 lặp cả cụm "nhà văn
    nguyễn ngọc" ngay trong MỘT lần giải mã offline, và một bản kế hoạch trước
    đã đọc nhầm ca đó thành bằng chứng bộ nhận dạng sửa dấu giữa hai lần giải mã.
    Hai hiện tượng cần hai cơ chế khác nhau, nên phải đếm riêng.
    """
    toks = text.split()
    count = 0
    i = 0
    while i < len(toks):
        hit = 0
        for n in range(min(6, (len(toks) - i) // 2), 1, -1):
            if toks[i : i + n] == toks[i + n : i + 2 * n]:
                hit = n
                break
        if hit:
            count += 1
            i += hit * 2
        else:
            i += 1
    return count


def _agree_prefix(prev: str, cur: str) -> str:
    """Phần hai hypothesis liên tiếp đồng ý, đã lùi về ranh giới từ.

    Nếu tiền tố chung dừng giữa một từ ở BẤT KỲ chuỗi nào thì từ đó chưa xong —
    cắt bỏ. Chỉ khi hai chuỗi giống hệt nhau thì từ cuối mới chắc chắn đã trọn.
    """
    n = lcp(prev, cur)
    cand = cur[:n]
    mid_word = (n < len(cur) and not cur[n].isspace()) or (
        n < len(prev) and not prev[n].isspace()
    )
    if mid_word:
        cut = cand.rfind(" ")
        cand = cand[:cut] if cut >= 0 else ""
    return cand.rstrip()


def _hold_back(text: str, syllables: int) -> str:
    """Giữ lại N âm tiết cuối chưa chốt. Tiếng Việt viết rời từng âm tiết nên
    âm tiết ở đây chính là token ngăn cách bởi khoảng trắng."""
    if syllables <= 0:
        return text
    toks = text.split()
    return " ".join(toks[:-syllables]) if len(toks) > syllables else ""


def local_agreement(snapshots: list[tuple[float, float, str]], hold_back: int) -> dict:
    """Chạy LocalAgreement-2 ngoại tuyến trên một chuỗi snapshot đã ghi sẵn.

    Chạy ngoại tuyến nên đổi mức hold-back không tốn thêm một lần decode nào —
    cùng một chuỗi snapshot được chấm lại nhiều lần.
    """
    committed = ""
    commit_points: list[tuple[float, int]] = []  # (mốc audio, độ dài sau khi chốt)
    committed_at_snapshot: list[int] = []
    tone_flips = 0
    prev = None

    for audio_s, _wall_s, hyp in snapshots:
        committed_before = len(committed)
        if prev is not None:
            cand = _hold_back(_agree_prefix(prev, hyp), hold_back)
            # Phần đã chốt là bất biến: chỉ nhận khi nó DÀI HƠN và vẫn nối tiếp
            # đúng thứ đã chốt. Một ứng viên lệch mốc neo bị bỏ qua, không ghi đè.
            if len(cand) > len(committed) and cand.startswith(committed):
                committed = cand
                commit_points.append((audio_s, len(committed)))
            # Sửa dấu Ở VÙNG ĐÃ CHỐT mới là thứ hold-back sinh ra để chặn; sửa ở
            # vùng chờ thì màn hình đằng nào cũng được phép vẽ lại.
            tone_flips += _tone_flips_at(prev, hyp, committed_before)
        committed_at_snapshot.append(len(committed))
        prev = hyp

    return {
        "committed": committed,
        "commit_points": commit_points,
        "committed_at_snapshot": committed_at_snapshot,
        "tone_flips": tone_flips,
    }


def _tone_flips_at(prev: str, cur: str, committed_len: int) -> int:
    """Số âm tiết cùng vị trí bị đổi mà chỉ khác dấu, nằm trong `committed_len`
    ký tự đầu. `committed_len = None` nghĩa là đếm trên cả chuỗi."""
    flips = 0
    offset = 0
    prev_toks, cur_toks = prev.split(), cur.split()
    for j in range(min(len(prev_toks), len(cur_toks))):
        start = prev.find(prev_toks[j], offset)
        offset = start + len(prev_toks[j]) if start >= 0 else offset
        if committed_len is not None and start >= committed_len:
            break
        a, b = prev_toks[j], cur_toks[j]
        if a != b and _fold_tone(a) == _fold_tone(b):
            flips += 1
    return flips


def transcribe(url: str, samples: np.ndarray, language: str, timeout: float) -> tuple[float, str]:
    """Một vòng decode qua sidecar. Trả (thời gian đo được tính bằng ms, text)."""
    buf = io.BytesIO()
    sf.write(buf, samples, SR, format="WAV", subtype="PCM_16")
    buf.seek(0)
    t0 = time.perf_counter()
    resp = requests.post(
        f"{url.rstrip('/')}/transcribe",
        files={"file": ("chunk.wav", buf, "audio/wav")},
        data={"language": language},
        timeout=timeout,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    if resp.status_code != 200:
        raise RuntimeError(f"sidecar {resp.status_code}: {resp.text[:200]}")
    return elapsed_ms, (resp.json().get("text") or "")


def run_utterance(utt, url: str, window_s: float, divisor: int, timeout: float,
                  levels: tuple[int, ...] = (0, 2)) -> dict:
    """Mô phỏng vòng partial của production trên một clip, ghi lại mọi snapshot.

    Đồng hồ ở đây là đồng hồ AUDIO: lượt thật nhận audio theo thời gian thực nên
    một giây trôi qua là một giây audio nạp thêm. Thời gian decode đo được (thật,
    qua HTTP) được cộng vào đồng hồ đó, nên một decode chậm hơn thời gian thực sẽ
    tự đẩy vòng sau ra xa — đúng như cổng duty của production làm.
    """
    audio, sr = sf.read(utt.audio_path, dtype="float32")
    if sr != SR:
        raise ValueError(f"{utt.id}: cần 16kHz, gặp {sr}")
    speech_s = len(audio) / SR
    audio = np.concatenate([np.zeros(int(PRE_ROLL_MS * SR / 1000), dtype="float32"), audio])
    total_ms = len(audio) / SR * 1000.0
    window_samples = int(window_s * SR)

    snapshots: list[tuple[float, float, str]] = []
    decode_ms: list[float] = []
    blank_skipped = 0
    next_decode_ms = 0.0

    tick = FEED_MS
    while True:
        fed_ms = min(tick, total_ms)
        if fed_ms >= MIN_AUDIO_MS and fed_ms >= next_decode_ms:
            fed_samples = int(fed_ms * SR / 1000)
            window = audio[max(0, fed_samples - window_samples) : fed_samples]
            d_ms, text = transcribe(url, window, utt.lang, timeout)
            decode_ms.append(d_ms)
            # Cổng duty tính từ lúc vòng này BẮT ĐẦU, không phải lúc nó xong.
            next_decode_ms = fed_ms + max(FEED_MS, divisor * d_ms)
            if text.strip():
                # audio_s = phần audio bản này nhìn thấy; wall_s = lúc nó lên được
                # màn hình. Hiệu hai số là độ trễ người dùng cảm nhận.
                snapshots.append((fed_ms / 1000.0, (fed_ms + d_ms) / 1000.0, text.strip()))
            else:
                # live-preview.ts bỏ qua chuỗi rỗng, nên nó không phải một lần
                # cập nhật màn hình và không được tính là snapshot.
                blank_skipped += 1
        if fed_ms >= total_ms:
            break
        tick += FEED_MS

    _, final_hyp = transcribe(url, audio, utt.lang, timeout)

    refresh_gaps = [
        (snapshots[i][1] - snapshots[i - 1][1]) * 1000.0 for i in range(1, len(snapshots))
    ]
    n_updates = sum(
        1 for i, s in enumerate(snapshots) if i == 0 or s[2] != snapshots[i - 1][2]
    )

    row = {
        "id": utt.id,
        "audio_seconds": round(speech_s, 3),
        "n_updates": n_updates,
        "n_blank_skipped": blank_skipped,
        "decode_ms_p50": _pct(decode_ms, 0.50),
        "decode_ms_p95": _pct(decode_ms, 0.95),
        "refresh_ms_p50": _pct(refresh_gaps, 0.50),
        "refresh_ms_p95": _pct(refresh_gaps, 0.95),
        "reference": utt.ref_text,
        "final_hypothesis": final_hyp.strip(),
        # Chuỗi snapshot thô. Lưu lại vì mọi phép chấm lại — LocalAgreement-n,
        # hold-back khác, luật chốt khác — chạy được NGOẠI TUYẾN trên đúng chuỗi
        # này mà không tốn thêm một lần decode nào. Bản đầu không lưu, nên thử
        # một biến thể phải chạy lại cả 50 clip.
        "snapshots": [[round(a, 3), round(w, 4), t] for a, w, t in snapshots],
        # Không phụ thuộc hold-back: bộ nhận dạng có sửa dấu ở BẤT KỲ đâu không.
        # Tách khỏi `tone_flips_hbN` để phân biệt "engine có sửa dấu" với "nó sửa
        # vào vùng ta đã chốt" — chỉ vế sau mới biện minh cho hold-back.
        "tone_flips_any": sum(
            _tone_flips_at(snapshots[i - 1][2], snapshots[i][2], None)
            for i in range(1, len(snapshots))
        ),
    }

    for hb in levels:
        res = local_agreement(snapshots, hb)
        committed = res["committed"]
        row.update(_commit_metrics(committed, res, snapshots, speech_s, final_hyp, hb))
    return row


def _commit_metrics(committed, res, snapshots, speech_s, final_hyp, hb) -> dict:
    """Chuyển một lần chạy LocalAgreement thành các con số của báo cáo."""
    # Độ trễ chốt: mỗi ký tự đã chốt phải chờ bao lâu (tính bằng audio) kể từ lần
    # đầu nó xuất hiện trên màn hình cho tới lúc nó hết bị phép sửa.
    first_seen: dict[int, float] = {}
    for audio_s, _w, hyp in snapshots:
        for i in range(len(hyp)):
            first_seen.setdefault(i, audio_s)
    lags = []
    prev_len = 0
    for audio_s, new_len in res["commit_points"]:
        for i in range(prev_len, new_len):
            if i in first_seen:
                lags.append(max(0.0, audio_s - first_seen[i]))
        prev_len = new_len

    # Đứng im: khoảng audio liên tiếp mà số ký tự chốt không tăng, trong lúc
    # người ta VẪN ĐANG NÓI. Đứng im sau khi hết audio thì không ai thấy.
    stalls = []
    if snapshots:
        marks = (
            [snapshots[0][0]]
            + [a for a, _ in res["commit_points"]]
            + [snapshots[-1][0]]
        )
        stalls = [marks[i] - marks[i - 1] for i in range(1, len(marks))]

    mismatch = len(committed) - lcp(committed, final_hyp.strip())
    return {
        f"committed_final_hb{hb}": committed,
        f"committed_chars_hb{hb}": len(committed),
        f"commit_rate_chars_per_s_hb{hb}": round(len(committed) / speech_s, 3) if speech_s else None,
        f"commit_lag_p50_s_hb{hb}": _pct(lags, 0.50),
        f"commit_lag_p95_s_hb{hb}": _pct(lags, 0.95),
        f"stall_max_s_hb{hb}": round(max(stalls), 4) if stalls else None,
        f"stall_p95_s_hb{hb}": _pct(stalls, 0.95),
        f"committed_vs_final_mismatch_chars_hb{hb}": max(0, mismatch),
        f"tone_flips_hb{hb}": res["tone_flips"],
        f"duplications_hb{hb}": _adjacent_duplications(committed),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", default="data/manifest-vi.jsonl")
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--window-seconds", type=float, default=9.0)
    ap.add_argument("--divisor", type=int, default=2)
    ap.add_argument("--hold-back", type=int, default=0,
                    help="mức hold-back thêm; 0 và 2 luôn được chấm")
    ap.add_argument("--timeout", type=float, default=60.0)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()

    # Cổng 8002 là giá trị thật của repo (env.schema.ts, docker-compose.yml),
    # không phải 8001.
    url = os.environ.get("LOCAL_STT_URL", "http://localhost:8002")
    try:
        health = requests.get(f"{url.rstrip('/')}/healthz", timeout=10)
    except requests.RequestException as err:
        print(f"sidecar không trả lời ở {url}: {err}", file=sys.stderr)
        return 2
    if health.status_code != 200:
        print(f"sidecar chưa sẵn sàng ở {url}: {health.status_code} {health.text}", file=sys.stderr)
        return 2

    levels = tuple(sorted({0, 2, a.hold_back}))
    manifest = BENCH / a.manifest if not Path(a.manifest).is_absolute() else Path(a.manifest)
    utterances = load_manifest(manifest)[: a.limit]

    a.out.parent.mkdir(parents=True, exist_ok=True)
    with a.out.open("w", encoding="utf-8") as out:
        for i, utt in enumerate(utterances, start=1):
            row = run_utterance(utt, url, a.window_seconds, a.divisor, a.timeout, levels)
            out.write(json.dumps(row, ensure_ascii=False) + "\n")
            out.flush()
            print(
                f"[{i}/{len(utterances)}] {utt.id} "
                f"chốt={row['committed_chars_hb0']}c "
                f"decode_p50={row['decode_ms_p50']}ms",
                file=sys.stderr,
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
