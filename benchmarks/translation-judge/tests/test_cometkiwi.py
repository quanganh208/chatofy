"""The cross-check's own arithmetic; the model itself is not loaded here."""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cometkiwi import ranks, severity_points, spearman  # noqa: E402


def test_ties_share_their_mean_rank():
    assert ranks([3.0, 1.0, 3.0, 2.0]) == [3.5, 1.0, 3.5, 2.0]


def test_spearman_is_minus_one_for_opposite_orders():
    assert math.isclose(spearman([0, 1, 5, 10], [0.9, 0.8, 0.5, 0.1]), -1.0)
    assert math.isnan(spearman([1, 1, 1], [0.1, 0.2, 0.3]))


def test_severity_points_average_over_repeats():
    answers = [
        {"errors": [{"severity": "major"}, {"severity": "minor"}]},
        {"errors": [{"severity": "critical"}]},
        {"errors": []},
    ]
    assert severity_points(answers) == (6 + 10 + 0) / 3
