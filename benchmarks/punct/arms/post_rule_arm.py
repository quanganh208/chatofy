"""The prod model with `punct_bench.post_rules` applied after it.

Variant: the rules joined by '+', e.g. "comma", "title", "comma+title".
"""
from arms.dewpoint_arm import load as load_dewpoint
from punct_bench import post_rules
from punct_bench.arm_protocol import main


def load(variant: str, threads: int):
    rules = set(variant.split("+"))
    restore = load_dewpoint("mmbert-int8emb", threads)
    return lambda text: post_rules.apply(restore(text), rules)


if __name__ == "__main__":
    main(load)
