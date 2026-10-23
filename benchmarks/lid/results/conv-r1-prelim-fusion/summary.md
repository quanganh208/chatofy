# LID bake-off `conv-r1-prelim-fusion`

Outcome: **INCOMPLETE**

## ambernet (cv None, tau_noise 0.0)

| criterion                      | bare                | src                 | src+voice           | threshold                               | data        |
| ------------------------------ | ------------------- | ------------------- | ------------------- | --------------------------------------- | ----------- |
| A-ACC.detect                   | 0.604 ✗ (n=604)     | 0.576 ✗ (n=604)     | 0.611 ✗ (n=604)     | >=0.95                                  | public      |
| A-ACC.pair                     | 0.649 ✗ (n=616)     | 0.638 ✗ (n=616)     | 0.654 ✗ (n=616)     | >=0.95                                  | public      |
| A1.en-vi                       | 0.957 ✗ (n=5612)    | 0.955 ✗ (n=5612)    | 0.957 ✗ (n=5612)    | >=0.97                                  | real        |
| A1.en-zh                       | 0.965 ✗ (n=4334)    | 0.963 ✗ (n=4334)    | 0.963 ✗ (n=4334)    | >=0.97                                  | mixed       |
| A1.vi-zh                       | 0.996 ✓ (n=3492)    | 0.996 ✓ (n=3492)    | 0.996 ✓ (n=3492)    | >=0.97                                  | mixed       |
| A2.en-vi                       | 0.765 ✗ (n=2050)    | 0.765 ✗ (n=2050)    | 0.765 ✗ (n=2050)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-vi.edacc                 | 0.731 · (n=1682)    | 0.725 · (n=1682)    | 0.723 · (n=1682)    | report                                  | edacc       |
| A2.en-vi.err_after_fallback    | 0.235 ✗ (n=2050)    | 0.240 ✗ (n=2050)    | 0.241 ✗ (n=2050)    | <=0.05                                  | real+cv     |
| A2.en-vi.rerecorded            | 0.750 · (n=56)      | 0.750 · (n=56)      | 0.768 · (n=56)      | report                                  | rerecorded  |
| A2.en-vi.vietmed               | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| A2.en-vi.vietmed-cut           | 0.953 · (n=300)     | 0.953 · (n=300)     | 0.953 · (n=300)     | report                                  | vietmed-cut |
| A2.en-vi.vimedcss              | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| A2.en-zh                       | 0.760 ✗ (n=3314)    | 0.760 ✗ (n=3314)    | 0.760 ✗ (n=3314)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-zh.ascend                | 0.739 · (n=1982)    | 0.739 · (n=1982)    | 0.739 · (n=1982)    | report                                  | ascend      |
| A2.en-zh.edacc                 | 0.796 · (n=1228)    | 0.794 · (n=1228)    | 0.794 · (n=1228)    | report                                  | edacc       |
| A2.en-zh.err_after_fallback    | 0.240 ✗ (n=3314)    | 0.241 ✗ (n=3314)    | 0.241 ✗ (n=3314)    | <=0.05                                  | real+cv     |
| A2.en-zh.rerecorded            | 0.750 · (n=104)     | 0.731 · (n=104)     | 0.721 · (n=104)     | report                                  | rerecorded  |
| A2.vi-zh                       | 0.901 ✓ (n=524)     | 0.901 ✓ (n=524)     | 0.901 ✓ (n=524)     | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.vi-zh.ascend                | 0.829 · (n=152)     | 0.829 · (n=152)     | 0.829 · (n=152)     | report                                  | ascend      |
| A2.vi-zh.err_after_fallback    | 0.099 ✗ (n=524)     | 0.097 ✗ (n=524)     | 0.097 ✗ (n=524)     | <=0.05                                  | real+cv     |
| A2.vi-zh.rerecorded            | 0.800 · (n=60)      | 0.783 · (n=60)      | 0.817 · (n=60)      | report                                  | rerecorded  |
| A2.vi-zh.vietmed               | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| A2.vi-zh.vietmed-cut           | 0.960 · (n=300)     | 0.963 · (n=300)     | 0.957 · (n=300)     | report                                  | vietmed-cut |
| A2.vi-zh.vimedcss              | 0.667 · (n=6)       | 0.833 · (n=6)       | 0.833 · (n=6)       | report                                  | vimedcss    |
| A3.long.vien                   | 0.919 ✗ (n=3941)    | 0.915 ✗ (n=3941)    | 0.920 ✗ (n=3941)    | >=0.95                                  | real        |
| A3.long.zh                     | 0.995 ✓ (n=1135)    | 0.995 ✓ (n=1135)    | 0.995 ✓ (n=1135)    | >=0.95                                  | mixed       |
| A3.short.vien                  | 0.673 ✗ (n=1505)    | 0.668 ✗ (n=1505)    | 0.668 ✗ (n=1505)    | >=0.85                                  | real        |
| A3.short.zh                    | 0.617 ✗ (n=765)     | 0.617 ✗ (n=765)     | 0.617 ✗ (n=765)     | >=0.85                                  | real        |
| A4                             | 0.990 ✓ (n=1833)    | 0.990 ✓ (n=1833)    | 0.990 ✓ (n=1833)    | >=0.95                                  | real        |
| A5                             | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | >=0.90 rejected                         | esc50+real  |
| A5.esc50                       | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| A5.real                        | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| A6.en-vi.changed               | 0.172 ✗ (n=6758)    | 0.172 ✗ (n=6758)    | 0.174 ✗ (n=6758)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 623.497 ✓ (n=7662)  | 623.497 ✓ (n=7662)  | 623.497 ✓ (n=7662)  | <=1000                                  | real        |
| A6.en-zh.changed               | 0.198 ✗ (n=6428)    | 0.199 ✗ (n=6428)    | 0.199 ✗ (n=6428)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 660.000 ✓ (n=7648)  | 660.000 ✓ (n=7648)  | 660.000 ✓ (n=7648)  | <=1000                                  | mixed       |
| A6.vi-zh.changed               | 0.176 ✗ (n=3952)    | 0.176 ✗ (n=3952)    | 0.177 ✗ (n=3952)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 623.260 ✓ (n=4016)  | 623.260 ✓ (n=4016)  | 623.260 ✓ (n=4016)  | <=1000                                  | mixed       |
| A7                             | 239.883 ✗ (n=29672) | 239.883 ✗ (n=29672) | 239.883 ✗ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.100 ✗ (n=200)     | 0.110 ✗ (n=200)     | 0.120 ✗ (n=200)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.817 · (n=6758)    | 0.817 · (n=6758)    | 0.817 · (n=6758)    | report                                  | real        |
| lock.en-zh.accuracy            | 0.787 · (n=6428)    | 0.787 · (n=6428)    | 0.787 · (n=6428)    | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.823 · (n=3952)    | 0.823 · (n=3952)    | 0.823 · (n=3952)    | report                                  | mixed       |
| zh_real.A1.en-zh               | 0.992 · (n=1270)    | 0.992 · (n=1270)    | 0.992 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh               | 0.987 · (n=150)     | 0.987 · (n=150)     | 0.987 · (n=150)     | report                                  | real        |
| zh_real.A3                     | 0.786 · (n=1400)    | 0.786 · (n=1400)    | 0.786 · (n=1400)    | report                                  | real        |

## recognizer_ambernet (cv logo, tau_noise 0.0)

| criterion                      | bare                | src                 | src+voice           | threshold                               | data        |
| ------------------------------ | ------------------- | ------------------- | ------------------- | --------------------------------------- | ----------- |
| A-ACC.detect                   | 0.815 ✗ (n=604)     | 0.647 ✗ (n=604)     | 0.801 ✗ (n=604)     | >=0.95                                  | public      |
| A-ACC.pair                     | 0.883 ✗ (n=616)     | 0.724 ✗ (n=616)     | 0.893 ✗ (n=616)     | >=0.95                                  | public      |
| A1.en-vi                       | 0.983 ✓ (n=5612)    | 0.964 ✗ (n=5612)    | 0.980 ✓ (n=5612)    | >=0.97                                  | real        |
| A1.en-zh                       | 0.955 ✗ (n=4334)    | 0.952 ✗ (n=4334)    | 0.950 ✗ (n=4334)    | >=0.97                                  | mixed       |
| A1.vi-zh                       | 0.995 ✓ (n=3492)    | 0.996 ✓ (n=3492)    | 0.993 ✓ (n=3492)    | >=0.97                                  | mixed       |
| A2.en-vi                       | 0.942 ✓ (n=2050)    | 0.942 ✓ (n=2050)    | 0.942 ✓ (n=2050)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-vi.edacc                 | 0.973 · (n=1682)    | 0.940 · (n=1682)    | 0.949 · (n=1682)    | report                                  | edacc       |
| A2.en-vi.err_after_fallback    | 0.058 ✗ (n=2050)    | 0.084 ✗ (n=2050)    | 0.080 ✗ (n=2050)    | <=0.05                                  | real+cv     |
| A2.en-vi.rerecorded            | 0.929 · (n=56)      | 0.929 · (n=56)      | 0.893 · (n=56)      | report                                  | rerecorded  |
| A2.en-vi.vietmed               | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| A2.en-vi.vietmed-cut           | 0.780 · (n=300)     | 0.783 · (n=300)     | 0.767 · (n=300)     | report                                  | vietmed-cut |
| A2.en-vi.vimedcss              | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| A2.en-zh                       | 0.516 ✗ (n=3314)    | 0.516 ✗ (n=3314)    | 0.516 ✗ (n=3314)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-zh.ascend                | 0.510 · (n=1982)    | 0.514 · (n=1982)    | 0.538 · (n=1982)    | report                                  | ascend      |
| A2.en-zh.edacc                 | 0.502 · (n=1228)    | 0.519 · (n=1228)    | 0.564 · (n=1228)    | report                                  | edacc       |
| A2.en-zh.err_after_fallback    | 0.484 ✗ (n=3314)    | 0.477 ✗ (n=3314)    | 0.447 ✗ (n=3314)    | <=0.05                                  | real+cv     |
| A2.en-zh.rerecorded            | 0.808 · (n=104)     | 0.740 · (n=104)     | 0.692 · (n=104)     | report                                  | rerecorded  |
| A2.vi-zh                       | 0.828 ✗ (n=524)     | 0.828 ✗ (n=524)     | 0.828 ✗ (n=524)     | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.vi-zh.ascend                | 0.855 · (n=152)     | 0.901 · (n=152)     | 0.934 · (n=152)     | report                                  | ascend      |
| A2.vi-zh.err_after_fallback    | 0.172 ✗ (n=524)     | 0.164 ✗ (n=524)     | 0.179 ✗ (n=524)     | <=0.05                                  | real+cv     |
| A2.vi-zh.rerecorded            | 0.967 · (n=60)      | 0.983 · (n=60)      | 0.933 · (n=60)      | report                                  | rerecorded  |
| A2.vi-zh.vietmed               | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| A2.vi-zh.vietmed-cut           | 0.787 · (n=300)     | 0.770 · (n=300)     | 0.737 · (n=300)     | report                                  | vietmed-cut |
| A2.vi-zh.vimedcss              | 0.667 · (n=6)       | 0.833 · (n=6)       | 0.833 · (n=6)       | report                                  | vimedcss    |
| A3.long.vien                   | 0.964 ✓ (n=3941)    | 0.938 ✗ (n=3941)    | 0.962 ✓ (n=3941)    | >=0.95                                  | real        |
| A3.long.zh                     | 0.959 ✓ (n=1135)    | 0.959 ✓ (n=1135)    | 0.959 ✓ (n=1135)    | >=0.95                                  | mixed       |
| A3.short.vien                  | 0.595 ✗ (n=1505)    | 0.569 ✗ (n=1505)    | 0.643 ✗ (n=1505)    | >=0.85                                  | real        |
| A3.short.zh                    | 0.384 ✗ (n=765)     | 0.384 ✗ (n=765)     | 0.450 ✗ (n=765)     | >=0.85                                  | real        |
| A4                             | 0.980 ✓ (n=1833)    | 0.979 ✓ (n=1833)    | 0.976 ✓ (n=1833)    | >=0.95                                  | real        |
| A5                             | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | >=0.90 rejected                         | esc50+real  |
| A5.esc50                       | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| A5.real                        | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| A6.en-vi.changed               | 0.267 ✗ (n=6758)    | 0.271 ✗ (n=6758)    | 0.272 ✗ (n=6758)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 752.390 ✓ (n=7662)  | 752.390 ✓ (n=7662)  | 752.390 ✓ (n=7662)  | <=1000                                  | real        |
| A6.en-zh.changed               | 0.284 ✗ (n=6428)    | 0.289 ✗ (n=6428)    | 0.290 ✗ (n=6428)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 756.830 ✓ (n=7648)  | 756.830 ✓ (n=7648)  | 756.830 ✓ (n=7648)  | <=1000                                  | mixed       |
| A6.vi-zh.changed               | 0.214 ✗ (n=3952)    | 0.226 ✗ (n=3952)    | 0.217 ✗ (n=3952)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 673.980 ✓ (n=4016)  | 673.980 ✓ (n=4016)  | 673.980 ✓ (n=4016)  | <=1000                                  | mixed       |
| A7                             | 257.224 ✗ (n=29672) | 257.224 ✗ (n=29672) | 257.224 ✗ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.020 ✓ (n=200)     | 0.020 ✓ (n=200)     | 0.020 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.721 · (n=6758)    | 0.716 · (n=6758)    | 0.721 · (n=6758)    | report                                  | real        |
| lock.en-zh.accuracy            | 0.666 · (n=6428)    | 0.658 · (n=6428)    | 0.666 · (n=6428)    | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.791 · (n=3952)    | 0.772 · (n=3952)    | 0.791 · (n=3952)    | report                                  | mixed       |
| zh_real.A1.en-zh               | 0.877 · (n=1270)    | 0.867 · (n=1270)    | 0.860 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh               | 0.987 · (n=150)     | 0.987 · (n=150)     | 0.987 · (n=150)     | report                                  | real        |
| zh_real.A3                     | 0.631 · (n=1400)    | 0.631 · (n=1400)    | 0.666 · (n=1400)    | report                                  | real        |

## recognizer_competition (cv logo, tau_noise 0.0)

| criterion                      | bare                | src                 | src+voice           | threshold                               | data        |
| ------------------------------ | ------------------- | ------------------- | ------------------- | --------------------------------------- | ----------- |
| A-ACC.detect                   | 0.929 ✗ (n=604)     | 0.929 ✗ (n=604)     | 0.929 ✗ (n=604)     | >=0.95                                  | public      |
| A-ACC.pair                     | 0.974 ✓ (n=616)     | 0.974 ✓ (n=616)     | 0.974 ✓ (n=616)     | >=0.95                                  | public      |
| A1.en-vi                       | 0.988 ✓ (n=5612)    | 0.988 ✓ (n=5612)    | 0.988 ✓ (n=5612)    | >=0.97                                  | real        |
| A1.en-zh                       | 0.884 ✗ (n=4334)    | 0.884 ✗ (n=4334)    | 0.884 ✗ (n=4334)    | >=0.97                                  | mixed       |
| A1.vi-zh                       | 0.981 ✓ (n=3492)    | 0.981 ✓ (n=3492)    | 0.981 ✓ (n=3492)    | >=0.97                                  | mixed       |
| A2.en-vi                       | 0.895 ✗ (n=2050)    | 0.895 ✗ (n=2050)    | 0.895 ✗ (n=2050)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-vi.edacc                 | 0.942 · (n=1682)    | 0.942 · (n=1682)    | 0.942 · (n=1682)    | report                                  | edacc       |
| A2.en-vi.err_after_fallback    | 0.105 ✗ (n=2050)    | 0.105 ✗ (n=2050)    | 0.105 ✗ (n=2050)    | <=0.05                                  | real+cv     |
| A2.en-vi.rerecorded            | 0.857 · (n=56)      | 0.857 · (n=56)      | 0.857 · (n=56)      | report                                  | rerecorded  |
| A2.en-vi.vietmed               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vietmed     |
| A2.en-vi.vietmed-cut           | 0.647 · (n=300)     | 0.647 · (n=300)     | 0.647 · (n=300)     | report                                  | vietmed-cut |
| A2.en-vi.vimedcss              | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| A2.en-zh                       | 0.479 ✗ (n=3314)    | 0.479 ✗ (n=3314)    | 0.479 ✗ (n=3314)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-zh.ascend                | 0.484 · (n=1982)    | 0.484 · (n=1982)    | 0.484 · (n=1982)    | report                                  | ascend      |
| A2.en-zh.edacc                 | 0.450 · (n=1228)    | 0.450 · (n=1228)    | 0.450 · (n=1228)    | report                                  | edacc       |
| A2.en-zh.err_after_fallback    | 0.521 ✗ (n=3314)    | 0.521 ✗ (n=3314)    | 0.521 ✗ (n=3314)    | <=0.05                                  | real+cv     |
| A2.en-zh.rerecorded            | 0.712 · (n=104)     | 0.712 · (n=104)     | 0.712 · (n=104)     | report                                  | rerecorded  |
| A2.vi-zh                       | 0.603 ✗ (n=524)     | 0.603 ✗ (n=524)     | 0.603 ✗ (n=524)     | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.vi-zh.ascend                | 0.645 · (n=152)     | 0.645 · (n=152)     | 0.645 · (n=152)     | report                                  | ascend      |
| A2.vi-zh.err_after_fallback    | 0.397 ✗ (n=524)     | 0.397 ✗ (n=524)     | 0.397 ✗ (n=524)     | <=0.05                                  | real+cv     |
| A2.vi-zh.rerecorded            | 0.867 · (n=60)      | 0.867 · (n=60)      | 0.867 · (n=60)      | report                                  | rerecorded  |
| A2.vi-zh.vietmed               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vietmed     |
| A2.vi-zh.vietmed-cut           | 0.520 · (n=300)     | 0.520 · (n=300)     | 0.520 · (n=300)     | report                                  | vietmed-cut |
| A2.vi-zh.vimedcss              | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vimedcss    |
| A3.long.vien                   | 0.968 ✓ (n=3941)    | 0.968 ✓ (n=3941)    | 0.968 ✓ (n=3941)    | >=0.95                                  | real        |
| A3.long.zh                     | 0.780 ✗ (n=1135)    | 0.780 ✗ (n=1135)    | 0.780 ✗ (n=1135)    | >=0.95                                  | mixed       |
| A3.short.vien                  | 0.516 ✗ (n=1505)    | 0.516 ✗ (n=1505)    | 0.516 ✗ (n=1505)    | >=0.85                                  | real        |
| A3.short.zh                    | 0.135 ✗ (n=765)     | 0.135 ✗ (n=765)     | 0.135 ✗ (n=765)     | >=0.85                                  | real        |
| A4                             | 0.973 ✓ (n=1833)    | 0.973 ✓ (n=1833)    | 0.973 ✓ (n=1833)    | >=0.95                                  | real        |
| A5                             | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | >=0.90 rejected                         | esc50+real  |
| A5.esc50                       | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| A5.real                        | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| A6.en-vi.changed               | 0.379 ✗ (n=6758)    | 0.379 ✗ (n=6758)    | 0.379 ✗ (n=6758)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 752.390 ✓ (n=7662)  | 752.390 ✓ (n=7662)  | 752.390 ✓ (n=7662)  | <=1000                                  | real        |
| A6.en-zh.changed               | 0.442 ✗ (n=6428)    | 0.442 ✗ (n=6428)    | 0.442 ✗ (n=6428)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 756.830 ✓ (n=7648)  | 756.830 ✓ (n=7648)  | 756.830 ✓ (n=7648)  | <=1000                                  | mixed       |
| A6.vi-zh.changed               | 0.336 ✗ (n=3952)    | 0.336 ✗ (n=3952)    | 0.336 ✗ (n=3952)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 673.980 ✓ (n=4016)  | 673.980 ✓ (n=4016)  | 673.980 ✓ (n=4016)  | <=1000                                  | mixed       |
| A7                             | 257.039 ✗ (n=29672) | 257.039 ✗ (n=29672) | 257.039 ✗ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.030 ✗ (n=200)     | 0.030 ✗ (n=200)     | 0.030 ✗ (n=200)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.010 ✓ (n=200)     | 0.010 ✓ (n=200)     | 0.010 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.618 · (n=6758)    | 0.618 · (n=6758)    | 0.618 · (n=6758)    | report                                  | real        |
| lock.en-zh.accuracy            | 0.521 · (n=6428)    | 0.521 · (n=6428)    | 0.521 · (n=6428)    | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.660 · (n=3952)    | 0.660 · (n=3952)    | 0.660 · (n=3952)    | report                                  | mixed       |
| zh_real.A1.en-zh               | 0.661 · (n=1270)    | 0.661 · (n=1270)    | 0.661 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh               | 0.947 · (n=150)     | 0.947 · (n=150)     | 0.947 · (n=150)     | report                                  | real        |
| zh_real.A3                     | 0.356 · (n=1400)    | 0.356 · (n=1400)    | 0.356 · (n=1400)    | report                                  | real        |
