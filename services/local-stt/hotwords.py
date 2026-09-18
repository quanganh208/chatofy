"""The hotword list a conversation may bias the Vietnamese decoder towards.

The recognizer is Vietnamese-only, so an English word inside a Vietnamese
sentence has no path through it: the decoder emits whatever Vietnamese syllables
sound closest, and the translator downstream then treats that as real Vietnamese
and repairs it into confident nonsense. Measured on a production conversation,
"một cái giải POKER" was stored as "một cái giải quốc cơ" and reached the reader
as "a national championship"; "siêu thị TARGET" became "siêu thị ta ghét". With
those two terms biased, both come back right.

Every term is named by the CALLER, and there is deliberately no standing list
shipped here. A standing list was built and measured: 28 common English words
moved WER on that conversation from 0.137 to 0.148, and a shorter list of 20
phonetically distinctive ones to 0.150, because biasing towards a word nobody
said costs real Vietnamese — "giải quốc cơ" became "giải ok", "nó là" became "đó
là". It bought nothing there either, since the English this speaker actually used
was his own vocabulary rather than anyone's common list. So biasing is opt-in per
conversation: the terms come from `TranslationHints.hotwords`, which the client
already collects and the translator already receives.
"""

#: Cap on terms actually sent to the decoder.
#:
#: `translationHintsSchema` already caps the socket at 48 entries; this is the
#: sidecar's own ceiling, on the same principle that makes the schema and the
#: prompt builder cap separately — one is what the socket accepts, this is what
#: the decoder will carry, and neither trusts the other. Each term costs a
#: context graph node per token at decode time.
MAX_HOTWORDS = 48

#: Longest single term, in characters. Matches the socket's per-entry cap.
MAX_TERM_LENGTH = 64


def normalize_term(term: str) -> str:
    """One caller-supplied term, folded to what the decoder can match.

    Upper-cased because that is the casing the model's own token table uses —
    this decoder emits "XIN CHÀO", and a lower-case hotword simply never matches
    anything. The slash is dropped rather than escaped: sherpa-onnx separates
    hotwords with it, so a term containing one would silently become two.
    """
    return term.replace("/", " ").strip().upper()[:MAX_TERM_LENGTH]


def build_hotwords(terms_in: list[str] | None = None) -> str:
    """One conversation's terms, folded into what the decoder expects.

    Returns the `/`-separated string sherpa-onnx wants, or an empty string when
    the caller named none and when nothing survives normalisation. Empty means
    "do not bias at all" rather than "bias towards an empty graph", and the
    caller reads it that way: it is also what selects the unbiased decoder.

    Order is the caller's own, so a list longer than the ceiling keeps the terms
    named first rather than an arbitrary slice.
    """
    seen: set[str] = set()
    terms: list[str] = []
    for term in terms_in or []:
        normalized = normalize_term(term)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        terms.append(normalized)
        if len(terms) >= MAX_HOTWORDS:
            break
    return "/".join(terms)
