"""Generate ElevenLabs Vietnamese audio for a subset of the corpus (A/B vs VieNeu).

Reads ELEVENLABS_API_KEY straight from apps/api/.env (never printed). Uses
eleven_multilingual_v2 — the VN-capable tier the pipeline's top quality profile
selects. Writes mp3 + records generation latency for a rough speed sanity check.
"""
import time
import urllib.request
from pathlib import Path

ENV_PATH = Path(r"D:\QuangAnh\chatofy\apps\api\.env")
import os

OUT = Path(__file__).parent / "out_elevenlabs"
OUT.mkdir(exist_ok=True)
# flash/turbo v2.5 accept language_code enforcement (multilingual_v2 does NOT);
# override via env to compare models fairly for Vietnamese.
MODEL = os.environ.get("EL_MODEL", "eleven_flash_v2_5")
LANG = os.environ.get("EL_LANG", "vi")
DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"  # Rachel

# Same sentences as corpus indices 1,3,5,8,13 — variety of length + a number/name/flight.
SENTENCES = {
    1: "Chào bạn, rất vui được gặp bạn.",
    3: "Tôi cần đặt hai vé máy bay đi Hà Nội vào thứ Sáu tuần này.",
    5: "Ông Nguyễn Văn An đã xác nhận đơn hàng số 4517.",
    8: "Tổng chi phí là một triệu hai trăm năm mươi nghìn đồng.",
    13: "Theo dự báo, chuyến bay VN235 sẽ hạ cánh lúc 14 giờ 40 phút.",
}


def read_env(path: Path) -> dict:
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def main() -> None:
    env = read_env(ENV_PATH)
    api_key = env.get("ELEVENLABS_API_KEY", "")
    voice = env.get("ELEVENLABS_TTS_VOICE_ID") or DEFAULT_VOICE
    if not api_key:
        raise SystemExit("ELEVENLABS_API_KEY empty in .env — cannot compare.")
    import json
    print(f"[cfg] model={MODEL} lang={LANG} voice={voice} key=***{api_key[-4:]}")

    for idx, text in SENTENCES.items():
        url = (f"https://api.elevenlabs.io/v1/text-to-speech/{voice}"
               f"?output_format=mp3_44100_128")
        payload = {
            "text": text,
            "model_id": MODEL,
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        }
        # multilingual_v2 rejects language_code; v3 is text-driven. Only send when
        # LANG set and not "none".
        if LANG and LANG != "none":
            payload["language_code"] = LANG
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            url, data=body,
            headers={"xi-api-key": api_key, "content-type": "application/json"},
            method="POST",
        )
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                audio = resp.read()
        except urllib.error.HTTPError as e:
            print(f"[{idx:02d}] HTTP {e.code}: {e.read().decode('utf-8', 'ignore')[:200]}")
            continue
        except Exception as e:
            print(f"[{idx:02d}] ERROR {e}")
            continue
        dt = time.perf_counter() - t0
        tag = MODEL.replace("eleven_", "")
        out = OUT / f"corpus_{idx:02d}_{tag}.mp3"
        out.write_bytes(audio)
        print(f"[{idx:02d}] {len(audio)/1024:6.1f} KB  round-trip={dt:.2f}s  -> {out.name}")


def _json_str(s: str) -> str:
    import json
    return json.dumps(s, ensure_ascii=False)


if __name__ == "__main__":
    main()
