"""Chỉ số của streaming, tách khỏi chỉ số của độ chính xác.

WER trả lời "bản cuối đúng không". Ba chỉ số dưới đây trả lời "trong lúc người ta
còn đang nói thì màn hình thế nào" — đó mới là thứ streaming sinh ra để giải quyết.
"""


def lcp(a: str, b: str) -> int:
    """Độ dài tiền tố chung."""
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


def stream_stats(snapshots: list[tuple[float, float, str]]) -> dict:
    """snapshots = [(audio_s đã nạp, wall_s kể từ lúc bắt đầu, hypothesis)].

    - ttft_audio_s: đã phải nạp bao nhiêu giây audio trước khi có chữ đầu tiên.
    - lag_p50/p95_s: wall clock chậm hơn audio bao nhiêu tại mỗi mốc. Âm nghĩa là
      engine chạy nhanh hơn thời gian thực.
    - rewrite_chars / rewrite_rate: bao nhiêu ký tự đã hiện lên rồi bị sửa. Đây là
      chỉ số phân biệt streaming thật với re-decode: re-decode viết lại cả cửa sổ
      nên tỉ lệ cao, streaming chỉ nối thêm nên tỉ lệ gần 0.
    - n_updates: số lần văn bản thực sự đổi.
    """
    first_text = None
    lags = []
    rewrite = 0
    updates = 0
    prev = ""
    for audio_s, wall_s, hyp in snapshots:
        hyp = (hyp or "").strip()
        if hyp and first_text is None:
            first_text = audio_s
        lags.append(wall_s - audio_s)
        if hyp != prev:
            updates += 1
            # Ký tự của bản trước nằm ngoài tiền tố chung là ký tự bị viết lại.
            rewrite += max(0, len(prev) - lcp(prev, hyp))
            prev = hyp
    final_len = max(1, len(prev))
    lags_sorted = sorted(lags)
    return {
        "ttft_audio_s": first_text,
        "lag_p50_s": round(lags_sorted[len(lags_sorted) // 2], 4) if lags else None,
        "lag_p95_s": round(lags_sorted[int(0.95 * len(lags_sorted)) - 1], 4) if lags else None,
        "lag_max_s": round(max(lags), 4) if lags else None,
        "rewrite_chars": rewrite,
        "rewrite_rate": round(rewrite / final_len, 4),
        "n_updates": updates,
        "final_chars": len(prev),
    }
