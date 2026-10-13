"""Giữ sidecar TTS bận, đúng cảnh bản dịch câu trước đang được tổng hợp.

Không tham số: lặp mãi một câu tiếng Việt vào localhost:8003, như trước.

Với `--out`: tổng hợp MỖI câu trong `--sentences` đúng một lần qua sidecar và
ghi `sNNN.wav` vào thư mục đó, để `tts_bench.run_judge` chấm round-trip — tức
là đo đúng đường production (HTTP, chuẩn hoá chữ số của engine) thay vì nạp
model trong tiến trình như harness TTS.

    uv run python scripts/streaming-arms/tts_load.py --url http://localhost:18003 \\
        --language zh --voice 47 --sentences ../tts/data/zh-sentences-conversational.txt \\
        --out ../tts/results/zh-sidecar/wav/sid47
"""
import argparse
import json
import urllib.request
from pathlib import Path

TEXT = "Tôi muốn đặt một phòng cho hai đêm, bắt đầu từ ngày mai buổi chiều."


def synthesize(url: str, text: str, language: str, voice: str | None) -> bytes:
    payload = {"text": text, "language": language}
    if voice is not None:
        payload["voice"] = voice
    req = urllib.request.Request(
        f"{url.rstrip('/')}/synthesize",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def load_sentences(path: Path) -> list[tuple[str, str]]:
    """(sNNN, text) per non-comment line — the numbering `tts_bench` uses."""
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    texts = [line for line in lines if line and not line.startswith("#")]
    return [(f"s{i:03d}", text) for i, text in enumerate(texts, start=1)]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--url", default="http://localhost:8003")
    ap.add_argument("--language", default="vi")
    ap.add_argument("--voice", default=None)
    ap.add_argument("--sentences", type=Path)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()

    if a.out is None:
        while True:
            try:
                synthesize(a.url, TEXT, a.language, a.voice)
            except Exception:
                pass

    if a.sentences is None:
        ap.error("--out needs --sentences")
    a.out.mkdir(parents=True, exist_ok=True)
    for sid, text in load_sentences(a.sentences):
        (a.out / f"{sid}.wav").write_bytes(synthesize(a.url, text, a.language, a.voice))
    print(f"wrote {len(load_sentences(a.sentences))} WAVs -> {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
