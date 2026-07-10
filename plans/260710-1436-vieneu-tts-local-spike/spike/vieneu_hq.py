"""Regenerate the A/B sentences with more conservative sampling for stability.

Lower temperature / top_k reduce autoregressive drift → steadier reading of
numbers, names, and IDs (the failure spots). Writes to out_hq/ so the user can
A/B against the default-param set in out/.
"""
import os
import time
from pathlib import Path

_threads = os.environ.get("SPIKE_THREADS", "8")
os.environ.setdefault("OMP_NUM_THREADS", _threads)
os.environ.setdefault("MKL_NUM_THREADS", _threads)

import numpy as np  # noqa: E402
from vieneu import Vieneu  # noqa: E402

HERE = Path(__file__).parent
OUT = HERE / "out_hq"
OUT.mkdir(exist_ok=True)
SR = 48_000

SENTENCES = {
    1: "Chào bạn, rất vui được gặp bạn.",
    3: "Tôi cần đặt hai vé máy bay đi Hà Nội vào thứ Sáu tuần này.",
    5: "Ông Nguyễn Văn An đã xác nhận đơn hàng số 4517.",
    8: "Tổng chi phí là một triệu hai trăm năm mươi nghìn đồng.",
    13: "Theo dự báo, chuyến bay VN235 sẽ hạ cánh lúc 14 giờ 40 phút.",
}

# Conservative HQ preset — steadier than defaults (temp 0.8 / top_k 25 / top_p 0.95).
HQ = dict(temperature=0.55, top_k=20, top_p=0.9, repetition_penalty=1.3)


def main() -> None:
    tts = Vieneu(mode="v3turbo")
    voices = list(getattr(tts, "_preset_voices", {}).keys())
    voice = getattr(tts, "_default_voice", None) or (voices[0] if voices else None)
    tts.infer("Khởi động.", voice=voice)  # warm-up

    print(f"[cfg] voice={voice} params={HQ}")
    for idx, text in SENTENCES.items():
        t0 = time.perf_counter()
        audio = np.asarray(tts.infer(text, voice=voice, **HQ), dtype=np.float32)
        dt = time.perf_counter() - t0
        dur = len(audio) / SR
        tts.save(audio, OUT / f"corpus_{idx:02d}_hq.wav")
        print(f"[{idx:02d}] audio={dur:.2f}s gen={dt:.2f}s RTF={dt/dur:.3f} -> corpus_{idx:02d}_hq.wav")


if __name__ == "__main__":
    main()
