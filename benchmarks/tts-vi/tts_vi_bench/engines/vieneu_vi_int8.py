"""Vietnamese TTS — the same VieNeu engine on its int8 ONNX backbone graph.

A second arm rather than a second measurement of the first, because "is fp32
still worth it?" only has an answer if both graphs run the same sentences in the
same session. `services/local-tts` pins fp32 because that is the graph its two
voices were auditioned on, and nothing has ever measured what int8 would cost in
intelligibility.

That cost is CPU-dependent, which is the one thing worth recording next to the
WER. The package's own comment warns int8 distorts ("méo") on a CPU without VNNI,
and this machine has `avx512_vnni` — so a good result here is conditional on that
instruction set and does not transfer to a CPU that lacks it.

Everything else — voices, sampling parameters, seeding, the streaming path — is
inherited unchanged from the fp32 arm, so any difference between the two is
attributable to the graph and nothing else.
"""

from .vieneu_vi import VieNeuVi


class VieNeuViInt8(VieNeuVi):
    engine_id = "vieneu-vi-int8"
    PRECISION = "int8"
