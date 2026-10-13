"""Which display restorer serves which recognition language.

Vietnamese is Dewpoint (punctuation and case); Chinese is the CT-Transformer
(punctuation only). English needs none: Parakeet already writes cased,
punctuated text.

`PAUSE_LANGUAGES` is separate on purpose. Dewpoint reads the silence after each
word to drop a full stop the speaker never paused at; the CT-Transformer reads
text alone, so zh is not asked for pauses.
"""
from punctuation.restorer import DisplayRestorer
from punctuation.zh_punctuation import ZhPunctuationRestorer

RESTORERS = {"vi": DisplayRestorer(), "zh": ZhPunctuationRestorer()}

#: The languages whose `/transcribe` answer carries per-word pauses.
PAUSE_LANGUAGES = frozenset({"vi"})

#: The restorer whose absence is an outage of the display path (503, which the
#: API answers with a cooldown). Every other one answers 400 when unloaded, so a
#: missing secondary model can never pause Vietnamese restores.
PRIMARY_RESTORE_LANGUAGE = "vi"
