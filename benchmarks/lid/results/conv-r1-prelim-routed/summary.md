# LID bake-off `conv-r1-prelim-routed`

Outcome: **INCOMPLETE**

## routed_ambernet (cv None, tau_noise 0.0)

| criterion                      | bare                | src                 | src+voice           | threshold                               | data        |
| ------------------------------ | ------------------- | ------------------- | ------------------- | --------------------------------------- | ----------- |
| A-ACC.detect                   | 0.604 ✗ (n=604)     | 0.576 ✗ (n=604)     | 0.611 ✗ (n=604)     | >=0.95                                  | public      |
| A-ACC.pair                     | 0.974 ✓ (n=616)     | 0.961 ✓ (n=616)     | 0.977 ✓ (n=616)     | >=0.95                                  | public      |
| A1.en-vi                       | 0.988 ✓ (n=5612)    | 0.984 ✓ (n=5612)    | 0.987 ✓ (n=5612)    | >=0.97                                  | real        |
| A1.en-zh                       | 0.965 ✗ (n=4334)    | 0.963 ✗ (n=4334)    | 0.963 ✗ (n=4334)    | >=0.97                                  | mixed       |
| A1.vi-zh                       | 0.996 ✓ (n=3492)    | 0.996 ✓ (n=3492)    | 0.996 ✓ (n=3492)    | >=0.97                                  | mixed       |
| A2.en-vi                       | 0.895 ✗ (n=2050)    | 0.895 ✗ (n=2050)    | 0.895 ✗ (n=2050)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-vi.edacc                 | 0.942 · (n=1682)    | 0.937 · (n=1682)    | 0.941 · (n=1682)    | report                                  | edacc       |
| A2.en-vi.err_after_fallback    | 0.105 ✗ (n=2050)    | 0.112 ✗ (n=2050)    | 0.108 ✗ (n=2050)    | <=0.05                                  | real+cv     |
| A2.en-vi.rerecorded            | 0.857 · (n=56)      | 0.839 · (n=56)      | 0.875 · (n=56)      | report                                  | rerecorded  |
| A2.en-vi.vietmed               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vietmed     |
| A2.en-vi.vietmed-cut           | 0.647 · (n=300)     | 0.627 · (n=300)     | 0.627 · (n=300)     | report                                  | vietmed-cut |
| A2.en-vi.vimedcss              | 0.667 · (n=6)       | 0.833 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| A2.en-zh                       | 0.760 ✗ (n=3314)    | 0.760 ✗ (n=3314)    | 0.760 ✗ (n=3314)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-zh.ascend                | 0.739 · (n=1982)    | 0.739 · (n=1982)    | 0.739 · (n=1982)    | report                                  | ascend      |
| A2.en-zh.edacc                 | 0.796 · (n=1228)    | 0.794 · (n=1228)    | 0.794 · (n=1228)    | report                                  | edacc       |
| A2.en-zh.err_after_fallback    | 0.240 ✗ (n=3314)    | 0.241 ✗ (n=3314)    | 0.241 ✗ (n=3314)    | <=0.05                                  | real+cv     |
| A2.en-zh.rerecorded            | 0.750 · (n=104)     | 0.731 · (n=104)     | 0.721 · (n=104)     | report                                  | rerecorded  |
| A2.vi-zh                       | 0.901 ✓ (n=524)     | 0.901 ✓ (n=524)     | 0.901 ✓ (n=524)     | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.vi-zh.ascend                | 0.829 · (n=152)     | 0.829 · (n=152)     | 0.829 · (n=152)     | report                                  | ascend      |
| A2.vi-zh.err_after_fallback    | 0.099 ✗ (n=524)     | 0.101 ✗ (n=524)     | 0.097 ✗ (n=524)     | <=0.05                                  | real+cv     |
| A2.vi-zh.rerecorded            | 0.800 · (n=60)      | 0.783 · (n=60)      | 0.817 · (n=60)      | report                                  | rerecorded  |
| A2.vi-zh.vietmed               | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| A2.vi-zh.vietmed-cut           | 0.960 · (n=300)     | 0.957 · (n=300)     | 0.957 · (n=300)     | report                                  | vietmed-cut |
| A2.vi-zh.vimedcss              | 0.667 · (n=6)       | 0.833 · (n=6)       | 0.833 · (n=6)       | report                                  | vimedcss    |
| A3.long.vien                   | 0.919 ✗ (n=3941)    | 0.915 ✗ (n=3941)    | 0.920 ✗ (n=3941)    | >=0.95                                  | real        |
| A3.long.zh                     | 0.995 ✓ (n=1135)    | 0.995 ✓ (n=1135)    | 0.995 ✓ (n=1135)    | >=0.95                                  | mixed       |
| A3.short.vien                  | 0.673 ✗ (n=1505)    | 0.668 ✗ (n=1505)    | 0.668 ✗ (n=1505)    | >=0.85                                  | real        |
| A3.short.zh                    | 0.617 ✗ (n=765)     | 0.617 ✗ (n=765)     | 0.617 ✗ (n=765)     | >=0.85                                  | real        |
| A4                             | 0.981 ✓ (n=1833)    | 0.978 ✓ (n=1833)    | 0.979 ✓ (n=1833)    | >=0.95                                  | real        |
| A5                             | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | >=0.90 rejected                         | esc50+real  |
| A5.esc50                       | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| A5.real                        | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| A6.en-vi.changed               | 0.379 ✗ (n=6758)    | 0.379 ✗ (n=6758)    | 0.381 ✗ (n=6758)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 752.390 ✓ (n=7662)  | 752.390 ✓ (n=7662)  | 752.390 ✓ (n=7662)  | <=1000                                  | real        |
| A6.en-zh.changed               | 0.198 ✗ (n=6428)    | 0.199 ✗ (n=6428)    | 0.199 ✗ (n=6428)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 660.000 ✓ (n=7648)  | 660.000 ✓ (n=7648)  | 660.000 ✓ (n=7648)  | <=1000                                  | mixed       |
| A6.vi-zh.changed               | 0.176 ✗ (n=3952)    | 0.177 ✗ (n=3952)    | 0.177 ✗ (n=3952)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 623.260 ✓ (n=4016)  | 623.260 ✓ (n=4016)  | 623.260 ✓ (n=4016)  | <=1000                                  | mixed       |
| A7                             | 267.195 ✗ (n=29672) | 267.195 ✗ (n=29672) | 267.195 ✗ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.030 ✗ (n=200)     | 0.030 ✗ (n=200)     | 0.030 ✗ (n=200)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.010 ✓ (n=200)     | 0.010 ✓ (n=200)     | 0.010 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.618 · (n=6758)    | 0.618 · (n=6758)    | 0.618 · (n=6758)    | report                                  | real        |
| lock.en-zh.accuracy            | 0.787 · (n=6428)    | 0.787 · (n=6428)    | 0.787 · (n=6428)    | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.823 · (n=3952)    | 0.823 · (n=3952)    | 0.823 · (n=3952)    | report                                  | mixed       |
| zh_real.A1.en-zh               | 0.992 · (n=1270)    | 0.992 · (n=1270)    | 0.992 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh               | 0.987 · (n=150)     | 0.987 · (n=150)     | 0.987 · (n=150)     | report                                  | real        |
| zh_real.A3                     | 0.786 · (n=1400)    | 0.786 · (n=1400)    | 0.786 · (n=1400)    | report                                  | real        |
