"""Gemini Decision 1 as a LID arm: ACCURACY AND LATENCY PROBE, never shippable as is.

Gemini Decision 1 (`gemini-decision-1`, released 2026-11-11) answers typed
questions about one input, audio included, with calibrated probabilities and
no generated text. Each whole turn is sent as a 16 kHz WAV with one 3-way
choice (vi / en / zh), and the answer is stored under the `en+vi+zh` key every
other arm uses, so `score.py` masks it to each pair exactly as it does for
Whisper. Whole turns only (no prefixes): an external round trip of ~1-2 s
cannot serve the partial cadence, so the question this arm answers is whether
the model is a better final-turn judge (ceiling), and `scripts/make_arbiter_arm.py`
asks whether it helps where Whisper is unsure.

    uv run --frozen python arms/gemini_decision/arm.py \
        --manifest results/conv-r5-decision/manifest.jsonl --out results/conv-r5-decision --limit-calls 8300

Keys come from GEMINI_API_KEY (comma-separated, rotated on refusal) in the
environment or the repo-root .env, and are never printed. Every HTTP attempt
is appended to `<out>/gemini_decision.http.jsonl`, and the call cap counts the
lines already there, so a resumed run cannot spend past it. A turn the API
rejects outright (HTTP 400, e.g. a safety block) is logged to
`<out>/gemini_decision.failed.jsonl` and scored as a uniform answer, which can
only count against the arm.

Data consent: the owner accepted on 2026-11-14 sending these CC-BY / CC-BY-SA /
MIT turns to the free tier, which trains on what it receives. Noise turns
(CC-BY-NC) are excluded by `scripts/make_decision_run.py`.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BENCH_ROOT = HERE.parents[1]
REPO_ROOT = BENCH_ROOT.parents[1]
sys.path.insert(0, str(BENCH_ROOT))

from lid_bench import arm_io  # noqa: E402
from lid_bench.audio import TARGET_RATE  # noqa: E402

ARM = "gemini_decision"
MODEL = "gemini-decision-1"
URL = "https://generativelanguage.googleapis.com/v1beta/decisions"
QUESTION = {
    "lang": {
        "type": "choice",
        "instructions": "Which language is spoken in the audio?",
        "criteria": {"vi": "Vietnamese", "en": "English", "zh": "Mandarin Chinese"},
    }
}
REFUSED = {429, 503, 529}
RETRYABLE = REFUSED | {500, 502, 504}
EXTRA_ATTEMPTS = 5
UNIFORM = {"vi": 1 / 3, "en": 1 / 3, "zh": 1 / 3}
META = {"kind": "lid-model", "runtime": "external-api", "parity_passed": None, "new_model": True,
        "notes": [MODEL, "latency from dev desk, not prod host"]}


def load_keys(env_path: Path = REPO_ROOT / ".env") -> list[str]:
    """GEMINI_API_KEY from the environment, else the repo-root .env; never printed."""
    raw = os.environ.get("GEMINI_API_KEY", "")
    if not raw and env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("GEMINI_API_KEY="):
                raw = line.split("=", 1)[1].strip().strip("\"'")
                break
    return [k.strip() for k in raw.split(",") if k.strip()]


def wav_bytes(samples: np.ndarray, rate: int = TARGET_RATE) -> bytes:
    """Float samples in [-1, 1] as a mono 16-bit PCM WAV file."""
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm)
    return buffer.getvalue()


class CapReached(RuntimeError):
    pass


class Client:
    """Sequential Decisions API client: key rotation, back-off, a hard attempt cap and an HTTP log."""

    def __init__(self, keys: list[str], log_path: Path, cap: int, opener=urllib.request.urlopen,
                 sleep=time.sleep) -> None:
        if not keys:
            raise SystemExit("GEMINI_API_KEY is not set in the environment or the repo-root .env")
        self.keys = keys
        self.log_path = log_path
        self.cap = cap
        self.used = sum(1 for _ in log_path.open()) if log_path.exists() else 0
        self.opener = opener
        self.sleep = sleep
        self.index = 0
        self.current_id = ""
        self.shared_quota_warned = False

    def _log(self, row: dict) -> None:
        with self.log_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row) + "\n")

    def _post(self, body: bytes, key: str) -> tuple[int, bytes]:
        request = urllib.request.Request(URL, data=body, method="POST",
                                         headers={"x-goog-api-key": key, "content-type": "application/json"})
        try:
            with self.opener(request, timeout=60) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def ask(self, audio: bytes) -> dict[str, float]:
        body = json.dumps({"model": MODEL, "input": [{"type": "audio", "mime_type": "audio/wav",
                                                      "data": base64.b64encode(audio).decode()}],
                           "questions": QUESTION}).encode()
        refused_in_row = waits = 0
        problem = "no attempt"
        for _ in range(len(self.keys) + EXTRA_ATTEMPTS):
            if self.used >= self.cap:
                raise CapReached(f"call cap {self.cap} reached")
            self.used += 1
            started = time.perf_counter()
            try:
                status, payload = self._post(body, self.keys[self.index % len(self.keys)])
            except (urllib.error.URLError, TimeoutError, OSError) as error:
                self._log({"id": self.current_id, "status": "transport", "ms": None, "tokens": None})
                problem = f"transport: {error}"
                self.sleep(min(60.0, 3.0 * 2 ** waits))
                waits += 1
                continue
            ms = round((time.perf_counter() - started) * 1000, 1)
            tokens = None
            if status == 200:
                answer = json.loads(payload)
                tokens = (answer.get("usage") or {}).get("total_input_tokens")
                self._log({"id": self.current_id, "status": status, "ms": ms, "tokens": tokens})
                probs = answer["answers"]["lang"]["probabilities"]
                if not all(np.isfinite(float(probs.get(k, np.nan))) for k in UNIFORM):
                    raise RuntimeError(f"{self.current_id}: answer without vi/en/zh probabilities")
                return {k: float(probs[k]) for k in UNIFORM}
            self._log({"id": self.current_id, "status": status, "ms": ms, "tokens": tokens})
            problem = f"HTTP {status}"
            if status in REFUSED:
                refused_in_row += 1
                self.index += 1
                if refused_in_row >= len(self.keys):
                    if len(self.keys) > 1 and not self.shared_quota_warned:
                        print("same-project quota suspected: every key refused in a row, backing off",
                              file=sys.stderr)
                        self.shared_quota_warned = True
                    refused_in_row = 0
                    self.sleep(min(60.0, 3.0 * 2 ** waits))
                    waits += 1
            elif status in RETRYABLE:
                self.sleep(min(60.0, 3.0 * 2 ** waits))
                waits += 1
            else:
                raise RejectedTurn(f"HTTP {status}: {payload[:200]!r}")
        raise RuntimeError(f"every attempt failed ({problem}); stopping so a resume can continue")


class RejectedTurn(RuntimeError):
    pass


def make_probs_fn(client: Client, failed_path: Path, turn_ids: list[str]):
    """`arm_io.run` calls this once per turn, in manifest order, with whole turns only."""
    order = iter(turn_ids)

    def probs_fn(samples: np.ndarray) -> dict[str, float]:
        client.current_id = next(order)
        try:
            return client.ask(wav_bytes(samples))
        except RejectedTurn as error:
            with failed_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps({"id": client.current_id, "error": str(error)}) + "\n")
            return dict(UNIFORM)

    return probs_fn


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--limit-calls", type=int, default=8300)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    baseline = arm_io.rss_mib()
    from lid_bench.manifest import load

    turns = load(args.manifest)
    partial = args.out / f"{ARM}.scores.partial.jsonl"
    done = arm_io._complete_turns(partial)
    pending = [t.id for t in turns if t.id not in done]
    client = Client(load_keys(), args.out / f"{ARM}.http.jsonl", args.limit_calls)
    print(f"{len(pending)} turns to ask; {client.used} HTTP attempts already logged; cap {args.limit_calls}",
          file=sys.stderr)
    try:
        arm_io.run(ARM, make_probs_fn(client, args.out / f"{ARM}.failed.jsonl", pending), args.manifest,
                   args.out, [], META, baseline)
    except CapReached as error:
        print(f"stopped: {error}; re-run with a higher --limit-calls to resume", file=sys.stderr)
        return 3
    print(f"done: {client.used} HTTP attempts", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
