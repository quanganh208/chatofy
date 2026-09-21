"""The Python splitter against the fixture the TypeScript splitter is held to.

Model-free on purpose, so it runs anywhere the sidecar's environment does —
this is the only guard against the two copies drifting apart.
"""
import json
from pathlib import Path

import pytest

from engines.clause_splitter import split_into_clauses

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "apps/api/src/modules/translate/audio/clause-splitter.cases.json"
)
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_matches_the_shared_fixture(case):
    assert split_into_clauses(case["input"]) == case["parts"]
