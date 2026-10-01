"""The floor any restorer has to beat: capitalize the first word, end with a stop.

What the display showed before restoration was added, give or take the ITN.
"""
from punct_bench.arm_protocol import main


def load(variant: str, threads: int):
    return lambda text: (text[:1].upper() + text[1:] + ".") if text else text


if __name__ == "__main__":
    main(load)
