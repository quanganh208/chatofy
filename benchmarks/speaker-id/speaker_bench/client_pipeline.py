"""Score a clusterer config through the real shipped TypeScript reducer.

The scratch port (`plans/260929-1038-conversation-quality-harness/sim.py`) and
a Python re-implementation of the client's settle path would both be guesses
at what `turn-keyed-transcript.ts` actually does, and cross-checking one guess
against another proves nothing. `scripts/attribution-reference.mjs --pipeline`
drives the genuine `observeVoice` / `promoteProvisional` from
`auto-attribution.ts`, so this module is a thin subprocess wrapper around it —
no clustering logic lives here.

**The gate proxy.** `run_attribution_rulers.py` calls this once per meeting with
the field it is scoring the gate against (the annotated `speech_ms` for ViYT
and old prod, the sidecar's real `sileroMs` for the conversation ruler). A turn
under `min_speech_ms` never reaches the node process with a vector: its vector
is replaced with `None` before the subprocess call, so the reducer never
observes it — exactly what happens in production, where a gated turn never
calls `/embed`. `run_client_pipeline` carries no algorithm of its own beyond
that substitution.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path
from typing import Sequence

BENCH_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BENCH_ROOT.parent.parent
REFERENCE = BENCH_ROOT / "scripts" / "attribution-reference.mjs"

#: The configuration the client actually ships, from `auto-attribution.ts`'s
#: `DEFAULT_AUTO_ATTRIBUTION`. Phase 06 flips this once the new bars are
#: accepted; until then it names the config every published number describes.
SHIPPED = {"tau_assign": 0.375, "tau_new": 0.325, "k_max": 2, "mint_confirmations": 2}


def run_client_pipeline(
    vectors: Sequence[Sequence[float] | None],
    speech_ms: Sequence[float],
    *,
    min_speech_ms: float,
    order: Sequence[int] | None = None,
    **config: float | int,
) -> list[int | None]:
    """Run one meeting through the shipped TS reducer, with the speech gate applied.

    ``config`` takes ``tau_assign``, ``tau_new`` and optionally ``k_max`` /
    ``mint_confirmations`` (default 2 / 2, `SHIPPED`'s values) — callers pass
    `SHIPPED` or a swept config by `**`-unpacking it. ``order`` overrides
    arrival order for the perturbation arm; default is turn order.
    """
    if len(vectors) != len(speech_ms):
        raise ValueError(f"{len(vectors)} vectors but {len(speech_ms)} speech_ms values")
    if "tau_assign" not in config or "tau_new" not in config:
        raise ValueError("config needs at least tau_assign and tau_new")

    gated_vectors = [
        None if ms < min_speech_ms else (None if vector is None else [float(v) for v in vector])
        for vector, ms in zip(vectors, speech_ms)
    ]
    payload = {
        "config": {
            "tauAssign": config["tau_assign"],
            "tauNew": config["tau_new"],
            "kMax": config.get("k_max", 2),
            "mintConfirmations": config.get("mint_confirmations", 2),
        },
        "turns": [
            {"tag": str(index), "vector": vector} for index, vector in enumerate(gated_vectors)
        ],
    }
    if order is not None:
        payload["order"] = list(order)

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump(payload, handle)
        input_path = handle.name
    try:
        result = subprocess.run(
            ["node", str(REFERENCE), "--pipeline", input_path],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
        )
    finally:
        Path(input_path).unlink(missing_ok=True)

    if result.returncode != 0:
        raise RuntimeError(
            f"attribution-reference.mjs --pipeline failed: {result.stderr.strip()[:2000]}"
        )
    return json.loads(result.stdout)["labels"]
