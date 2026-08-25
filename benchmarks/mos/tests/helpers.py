"""Fixtures shared by the session and aggregation tests."""

from mos_bench.manifest import Clip


def make_balanced_clips(n: int = 4, systems: tuple[str, ...] = ("alpha", "beta")) -> list[Clip]:
    """Every system covers the same clip_ids — what a within-subjects panel needs."""
    return [
        Clip(clip_id=f"u{index:02d}", system=system, lang="vi", path=f"clips/{system}/{index}.wav")
        for system in systems
        for index in range(n)
    ]


def make_unbalanced_clips(
    n_per_system: int = 4, systems: tuple[str, ...] = ("alpha", "beta")
) -> list[Clip]:
    """Each system has its own clip_ids, so no two systems share material."""
    return [
        Clip(
            clip_id=f"{system}-{index:02d}",
            system=system,
            lang="vi",
            path=f"clips/{system}/{index:02d}.wav",
        )
        for system in systems
        for index in range(n_per_system)
    ]
