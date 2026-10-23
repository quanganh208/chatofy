# LID bake-off `conv-r3-hold`

Outcome: **G4**

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
| A6.en-vi.changed               | 0.107 ✗ (n=6758)    | 0.107 ✗ (n=6758)    | 0.107 ✗ (n=6758)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 1241.738 ✓ (n=7662) | 1241.738 ✓ (n=7662) | 1241.738 ✓ (n=7662) | <=3500                                  | real        |
| A6.en-zh.changed               | 0.120 ✗ (n=6428)    | 0.122 ✗ (n=6428)    | 0.121 ✗ (n=6428)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 1219.830 ✓ (n=7648) | 1219.830 ✓ (n=7648) | 1219.830 ✓ (n=7648) | <=3500                                  | mixed       |
| A6.vi-zh.changed               | 0.081 ✓ (n=3952)    | 0.081 ✓ (n=3952)    | 0.081 ✓ (n=3952)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 1239.030 ✓ (n=4016) | 1239.030 ✓ (n=4016) | 1239.030 ✓ (n=4016) | <=3500                                  | mixed       |
| A7                             | 239.883 ✗ (n=29672) | 239.883 ✗ (n=29672) | 239.883 ✗ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.100 ✗ (n=200)     | 0.110 ✗ (n=200)     | 0.120 ✗ (n=200)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.876 · (n=6527)    | 0.876 · (n=6527)    | 0.876 · (n=6527)    | report                                  | real        |
| lock.en-zh.accuracy            | 0.851 · (n=6036)    | 0.851 · (n=6036)    | 0.851 · (n=6036)    | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.914 · (n=3890)    | 0.914 · (n=3890)    | 0.914 · (n=3890)    | report                                  | mixed       |
| zh_real.A1.en-zh               | 0.992 · (n=1270)    | 0.992 · (n=1270)    | 0.992 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh               | 0.987 · (n=150)     | 0.987 · (n=150)     | 0.987 · (n=150)     | report                                  | real        |
| zh_real.A3                     | 0.786 · (n=1400)    | 0.786 · (n=1400)    | 0.786 · (n=1400)    | report                                  | real        |

## mms_lid (cv None, tau_noise 0.0)

| criterion                      | bare                 | src                  | src+voice            | threshold                               | data        |
| ------------------------------ | -------------------- | -------------------- | -------------------- | --------------------------------------- | ----------- |
| A-ACC.detect                   | 0.755 ✗ (n=604)      | 0.646 ✗ (n=604)      | 0.765 ✗ (n=604)      | >=0.95                                  | public      |
| A-ACC.pair                     | 0.758 ✗ (n=616)      | 0.688 ✗ (n=616)      | 0.763 ✗ (n=616)      | >=0.95                                  | public      |
| A1.en-vi                       | 0.966 ✗ (n=5612)     | 0.958 ✗ (n=5612)     | 0.966 ✗ (n=5612)     | >=0.97                                  | real        |
| A1.en-zh                       | 0.980 ✓ (n=4334)     | 0.976 ✓ (n=4334)     | 0.976 ✓ (n=4334)     | >=0.97                                  | mixed       |
| A1.vi-zh                       | 0.997 ✓ (n=3492)     | 0.997 ✓ (n=3492)     | 0.996 ✓ (n=3492)     | >=0.97                                  | mixed       |
| A2.en-vi                       | 0.669 ✗ (n=2050)     | 0.669 ✗ (n=2050)     | 0.669 ✗ (n=2050)     | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-vi.edacc                 | 0.611 · (n=1682)     | 0.555 · (n=1682)     | 0.581 · (n=1682)     | report                                  | edacc       |
| A2.en-vi.err_after_fallback    | 0.331 ✗ (n=2050)     | 0.377 ✗ (n=2050)     | 0.360 ✗ (n=2050)     | <=0.05                                  | real+cv     |
| A2.en-vi.rerecorded            | 0.679 · (n=56)       | 0.679 · (n=56)       | 0.536 · (n=56)       | report                                  | rerecorded  |
| A2.en-vi.vietmed               | 1.000 · (n=6)        | 1.000 · (n=6)        | 1.000 · (n=6)        | report                                  | vietmed     |
| A2.en-vi.vietmed-cut           | 0.987 · (n=300)      | 0.987 · (n=300)      | 0.987 · (n=300)      | report                                  | vietmed-cut |
| A2.en-vi.vimedcss              | 0.667 · (n=6)        | 0.667 · (n=6)        | 0.667 · (n=6)        | report                                  | vimedcss    |
| A2.en-zh                       | 0.731 ✗ (n=3314)     | 0.731 ✗ (n=3314)     | 0.731 ✗ (n=3314)     | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-zh.ascend                | 0.691 · (n=1982)     | 0.691 · (n=1982)     | 0.691 · (n=1982)     | report                                  | ascend      |
| A2.en-zh.edacc                 | 0.800 · (n=1228)     | 0.707 · (n=1228)     | 0.707 · (n=1228)     | report                                  | edacc       |
| A2.en-zh.err_after_fallback    | 0.269 ✗ (n=3314)     | 0.303 ✗ (n=3314)     | 0.304 ✗ (n=3314)     | <=0.05                                  | real+cv     |
| A2.en-zh.rerecorded            | 0.692 · (n=104)      | 0.692 · (n=104)      | 0.663 · (n=104)      | report                                  | rerecorded  |
| A2.vi-zh                       | 0.908 ✓ (n=524)      | 0.908 ✓ (n=524)      | 0.908 ✓ (n=524)      | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.vi-zh.ascend                | 0.868 · (n=152)      | 0.868 · (n=152)      | 0.868 · (n=152)      | report                                  | ascend      |
| A2.vi-zh.err_after_fallback    | 0.092 ✗ (n=524)      | 0.092 ✗ (n=524)      | 0.090 ✗ (n=524)      | <=0.05                                  | real+cv     |
| A2.vi-zh.rerecorded            | 0.667 · (n=60)       | 0.667 · (n=60)       | 0.700 · (n=60)       | report                                  | rerecorded  |
| A2.vi-zh.vietmed               | 1.000 · (n=6)        | 1.000 · (n=6)        | 1.000 · (n=6)        | report                                  | vietmed     |
| A2.vi-zh.vietmed-cut           | 0.980 · (n=300)      | 0.980 · (n=300)      | 0.973 · (n=300)      | report                                  | vietmed-cut |
| A2.vi-zh.vimedcss              | 0.667 · (n=6)        | 0.667 · (n=6)        | 0.833 · (n=6)        | report                                  | vimedcss    |
| A3.long.vien                   | 0.949 ✗ (n=3941)     | 0.932 ✗ (n=3941)     | 0.951 ✓ (n=3941)     | >=0.95                                  | real        |
| A3.long.zh                     | 0.992 ✓ (n=1135)     | 0.992 ✓ (n=1135)     | 0.992 ✓ (n=1135)     | >=0.95                                  | mixed       |
| A3.short.vien                  | 0.618 ✗ (n=1505)     | 0.583 ✗ (n=1505)     | 0.628 ✗ (n=1505)     | >=0.85                                  | real        |
| A3.short.zh                    | 0.576 ✗ (n=765)      | 0.576 ✗ (n=765)      | 0.576 ✗ (n=765)      | >=0.85                                  | real        |
| A4                             | 0.992 ✓ (n=1833)     | 0.992 ✓ (n=1833)     | 0.992 ✓ (n=1833)     | >=0.95                                  | real        |
| A5                             | 0.906 ✓ (n=160)      | 0.906 ✓ (n=160)      | 0.906 ✓ (n=160)      | >=0.90 rejected                         | esc50+real  |
| A5.esc50                       | 0.900 · (n=80)       | 0.900 · (n=80)       | 0.900 · (n=80)       | report                                  | esc50       |
| A5.real                        | 0.912 · (n=80)       | 0.912 · (n=80)       | 0.912 · (n=80)       | report                                  | real        |
| A6.en-vi.changed               | 0.092 ✓ (n=6758)     | 0.096 ✓ (n=6758)     | 0.095 ✓ (n=6758)     | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 1954.638 ✓ (n=7662)  | 1954.638 ✓ (n=7662)  | 1954.638 ✓ (n=7662)  | <=3500                                  | real        |
| A6.en-zh.changed               | 0.084 ✓ (n=6428)     | 0.087 ✓ (n=6428)     | 0.087 ✓ (n=6428)     | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 1840.000 ✓ (n=7648)  | 1840.000 ✓ (n=7648)  | 1840.000 ✓ (n=7648)  | <=3500                                  | mixed       |
| A6.vi-zh.changed               | 0.049 ✓ (n=3952)     | 0.049 ✓ (n=3952)     | 0.050 ✓ (n=3952)     | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 1814.460 ✓ (n=4016)  | 1814.460 ✓ (n=4016)  | 1814.460 ✓ (n=4016)  | <=3500                                  | mixed       |
| A7                             | 2311.370 ✗ (n=29672) | 2311.370 ✗ (n=29672) | 2311.370 ✗ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.170 ✗ (n=200)      | 0.090 ✗ (n=200)      | 0.150 ✗ (n=200)      | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.000 ✓ (n=200)      | 0.000 ✓ (n=200)      | 0.000 ✓ (n=200)      | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.873 · (n=6339)     | 0.873 · (n=6339)     | 0.873 · (n=6339)     | report                                  | real        |
| lock.en-zh.accuracy            | 0.884 · (n=5744)     | 0.884 · (n=5744)     | 0.884 · (n=5744)     | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.947 · (n=3868)     | 0.947 · (n=3868)     | 0.947 · (n=3868)     | report                                  | mixed       |
| zh_real.A1.en-zh               | 0.991 · (n=1270)     | 0.991 · (n=1270)     | 0.991 · (n=1270)     | report                                  | real        |
| zh_real.A1.vi-zh               | 0.973 · (n=150)      | 0.973 · (n=150)      | 0.967 · (n=150)      | report                                  | real        |
| zh_real.A3                     | 0.762 · (n=1400)     | 0.762 · (n=1400)     | 0.762 · (n=1400)     | report                                  | real        |

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
| A6.en-vi.changed               | 0.063 ✓ (n=6758)    | 0.063 ✓ (n=6758)    | 0.063 ✓ (n=6758)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 3323.100 ✓ (n=7662) | 3323.100 ✓ (n=7662) | 3323.100 ✓ (n=7662) | <=3500                                  | real        |
| A6.en-zh.changed               | 0.103 ✗ (n=6428)    | 0.103 ✗ (n=6428)    | 0.103 ✗ (n=6428)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 3319.880 ✓ (n=7648) | 3319.880 ✓ (n=7648) | 3319.880 ✓ (n=7648) | <=3500                                  | mixed       |
| A6.vi-zh.changed               | 0.086 ✓ (n=3952)    | 0.086 ✓ (n=3952)    | 0.086 ✓ (n=3952)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 3200.190 ✓ (n=4016) | 3200.190 ✓ (n=4016) | 3200.190 ✓ (n=4016) | <=3500                                  | mixed       |
| A7                             | 257.039 ✗ (n=29672) | 257.039 ✗ (n=29672) | 257.039 ✗ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.030 ✗ (n=200)     | 0.030 ✗ (n=200)     | 0.030 ✗ (n=200)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.010 ✓ (n=200)     | 0.010 ✓ (n=200)     | 0.010 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.920 · (n=5117)    | 0.920 · (n=5117)    | 0.920 · (n=5117)    | report                                  | real        |
| lock.en-zh.accuracy            | 0.811 · (n=3610)    | 0.811 · (n=3610)    | 0.811 · (n=3610)    | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.896 · (n=3232)    | 0.896 · (n=3232)    | 0.896 · (n=3232)    | report                                  | mixed       |
| zh_real.A1.en-zh               | 0.661 · (n=1270)    | 0.661 · (n=1270)    | 0.661 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh               | 0.947 · (n=150)     | 0.947 · (n=150)     | 0.947 · (n=150)     | report                                  | real        |
| zh_real.A3                     | 0.356 · (n=1400)    | 0.356 · (n=1400)    | 0.356 · (n=1400)    | report                                  | real        |

## whisper_probs_base (cv None, tau_noise 0.0)

| criterion                      | bare                | src                 | src+voice           | threshold                               | data        |
| ------------------------------ | ------------------- | ------------------- | ------------------- | --------------------------------------- | ----------- |
| A-ACC.detect                   | 0.992 ✓ (n=604)     | 0.949 ✗ (n=604)     | 0.992 ✓ (n=604)     | >=0.95                                  | public      |
| A-ACC.pair                     | 0.994 ✓ (n=616)     | 0.961 ✓ (n=616)     | 0.995 ✓ (n=616)     | >=0.95                                  | public      |
| A1.en-vi                       | 0.989 ✓ (n=5612)    | 0.984 ✓ (n=5612)    | 0.989 ✓ (n=5612)    | >=0.97                                  | real        |
| A1.en-zh                       | 0.991 ✓ (n=4334)    | 0.991 ✓ (n=4334)    | 0.991 ✓ (n=4334)    | >=0.97                                  | mixed       |
| A1.vi-zh                       | 0.989 ✓ (n=3492)    | 0.987 ✓ (n=3492)    | 0.987 ✓ (n=3492)    | >=0.97                                  | mixed       |
| A2.en-vi                       | 0.954 ✓ (n=2050)    | 0.954 ✓ (n=2050)    | 0.954 ✓ (n=2050)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-vi.edacc                 | 1.000 · (n=1682)    | 0.996 · (n=1682)    | 0.999 · (n=1682)    | report                                  | edacc       |
| A2.en-vi.err_after_fallback    | 0.046 ✓ (n=2050)    | 0.051 ✗ (n=2050)    | 0.049 ✓ (n=2050)    | <=0.05                                  | real+cv     |
| A2.en-vi.rerecorded            | 0.893 · (n=56)      | 0.929 · (n=56)      | 0.911 · (n=56)      | report                                  | rerecorded  |
| A2.en-vi.vietmed               | 1.000 · (n=6)       | 0.833 · (n=6)       | 0.833 · (n=6)       | report                                  | vietmed     |
| A2.en-vi.vietmed-cut           | 0.713 · (n=300)     | 0.697 · (n=300)     | 0.697 · (n=300)     | report                                  | vietmed-cut |
| A2.en-vi.vimedcss              | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| A2.en-zh                       | 0.754 ✗ (n=3314)    | 0.754 ✗ (n=3314)    | 0.754 ✗ (n=3314)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-zh.ascend                | 0.608 · (n=1982)    | 0.614 · (n=1982)    | 0.618 · (n=1982)    | report                                  | ascend      |
| A2.en-zh.edacc                 | 0.997 · (n=1228)    | 0.923 · (n=1228)    | 0.923 · (n=1228)    | report                                  | edacc       |
| A2.en-zh.err_after_fallback    | 0.246 ✗ (n=3314)    | 0.270 ✗ (n=3314)    | 0.267 ✗ (n=3314)    | <=0.05                                  | real+cv     |
| A2.en-zh.rerecorded            | 0.673 · (n=104)     | 0.654 · (n=104)     | 0.683 · (n=104)     | report                                  | rerecorded  |
| A2.vi-zh                       | 0.832 ✗ (n=524)     | 0.832 ✗ (n=524)     | 0.832 ✗ (n=524)     | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.vi-zh.ascend                | 1.000 · (n=152)     | 1.000 · (n=152)     | 1.000 · (n=152)     | report                                  | ascend      |
| A2.vi-zh.err_after_fallback    | 0.168 ✗ (n=524)     | 0.181 ✗ (n=524)     | 0.162 ✗ (n=524)     | <=0.05                                  | real+cv     |
| A2.vi-zh.rerecorded            | 0.933 · (n=60)      | 0.767 · (n=60)      | 0.933 · (n=60)      | report                                  | rerecorded  |
| A2.vi-zh.vietmed               | 1.000 · (n=6)       | 0.833 · (n=6)       | 0.833 · (n=6)       | report                                  | vietmed     |
| A2.vi-zh.vietmed-cut           | 0.727 · (n=300)     | 0.740 · (n=300)     | 0.740 · (n=300)     | report                                  | vietmed-cut |
| A2.vi-zh.vimedcss              | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| A3.long.vien                   | 0.989 ✓ (n=3941)    | 0.981 ✓ (n=3941)    | 0.990 ✓ (n=3941)    | >=0.95                                  | real        |
| A3.long.zh                     | 0.986 ✓ (n=1135)    | 0.988 ✓ (n=1135)    | 0.985 ✓ (n=1135)    | >=0.95                                  | mixed       |
| A3.short.vien                  | 0.955 ✓ (n=1505)    | 0.931 ✓ (n=1505)    | 0.955 ✓ (n=1505)    | >=0.85                                  | real        |
| A3.short.zh                    | 0.473 ✗ (n=765)     | 0.481 ✗ (n=765)     | 0.486 ✗ (n=765)     | >=0.85                                  | real        |
| A4                             | 0.968 ✓ (n=1833)    | 0.968 ✓ (n=1833)    | 0.968 ✓ (n=1833)    | >=0.95                                  | real        |
| A5                             | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | >=0.90 rejected                         | esc50+real  |
| A5.esc50                       | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| A5.real                        | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| A6.en-vi.changed               | 0.121 ✗ (n=6758)    | 0.115 ✗ (n=6758)    | 0.121 ✗ (n=6758)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 2350.037 ✓ (n=7662) | 2363.320 ✓ (n=7662) | 2350.037 ✓ (n=7662) | <=3500                                  | real        |
| A6.en-zh.changed               | 0.013 ✓ (n=6428)    | 0.014 ✓ (n=6428)    | 0.014 ✓ (n=6428)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 2346.870 ✓ (n=7648) | 2347.820 ✓ (n=7648) | 2346.870 ✓ (n=7648) | <=3500                                  | mixed       |
| A6.vi-zh.changed               | 0.123 ✗ (n=3952)    | 0.118 ✗ (n=3952)    | 0.126 ✗ (n=3952)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 2349.700 ✓ (n=4016) | 2354.300 ✓ (n=4016) | 2349.700 ✓ (n=4016) | <=3500                                  | mixed       |
| A7                             | 358.250 ✗ (n=29672) | 358.250 ✗ (n=29672) | 358.250 ✗ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.851 · (n=5982)    | 0.861 · (n=5954)    | 0.851 · (n=5982)    | report                                  | real        |
| lock.en-zh.accuracy            | 0.979 · (n=4838)    | 0.981 · (n=4826)    | 0.979 · (n=4838)    | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.853 · (n=3658)    | 0.862 · (n=3634)    | 0.853 · (n=3658)    | report                                  | mixed       |
| zh_real.A1.en-zh               | 0.978 · (n=1270)    | 0.980 · (n=1270)    | 0.978 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh               | 0.987 · (n=150)     | 0.980 · (n=150)     | 0.987 · (n=150)     | report                                  | real        |
| zh_real.A3                     | 0.701 · (n=1400)    | 0.706 · (n=1400)    | 0.707 · (n=1400)    | report                                  | real        |

## whisper_probs_tiny (cv None, tau_noise 0.0)

| criterion                      | bare                | src                 | src+voice           | threshold                               | data        |
| ------------------------------ | ------------------- | ------------------- | ------------------- | --------------------------------------- | ----------- |
| A-ACC.detect                   | 0.995 ✓ (n=604)     | 0.995 ✓ (n=604)     | 0.998 ✓ (n=604)     | >=0.95                                  | public      |
| A-ACC.pair                     | 0.997 ✓ (n=616)     | 0.997 ✓ (n=616)     | 1.000 ✓ (n=616)     | >=0.95                                  | public      |
| A1.en-vi                       | 0.977 ✓ (n=5612)    | 0.978 ✓ (n=5612)    | 0.979 ✓ (n=5612)    | >=0.97                                  | real        |
| A1.en-zh                       | 0.989 ✓ (n=4334)    | 0.990 ✓ (n=4334)    | 0.990 ✓ (n=4334)    | >=0.97                                  | mixed       |
| A1.vi-zh                       | 0.964 ✗ (n=3492)    | 0.962 ✗ (n=3492)    | 0.962 ✗ (n=3492)    | >=0.97                                  | mixed       |
| A2.en-vi                       | 0.938 ✓ (n=2050)    | 0.938 ✓ (n=2050)    | 0.938 ✓ (n=2050)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-vi.edacc                 | 0.998 · (n=1682)    | 0.998 · (n=1682)    | 0.999 · (n=1682)    | report                                  | edacc       |
| A2.en-vi.err_after_fallback    | 0.062 ✗ (n=2050)    | 0.064 ✗ (n=2050)    | 0.064 ✗ (n=2050)    | <=0.05                                  | real+cv     |
| A2.en-vi.rerecorded            | 0.893 · (n=56)      | 0.893 · (n=56)      | 0.893 · (n=56)      | report                                  | rerecorded  |
| A2.en-vi.vietmed               | 0.333 · (n=6)       | 0.333 · (n=6)       | 0.333 · (n=6)       | report                                  | vietmed     |
| A2.en-vi.vietmed-cut           | 0.627 · (n=300)     | 0.613 · (n=300)     | 0.613 · (n=300)     | report                                  | vietmed-cut |
| A2.en-vi.vimedcss              | 0.667 · (n=6)       | 0.500 · (n=6)       | 0.500 · (n=6)       | report                                  | vimedcss    |
| A2.en-zh                       | 0.745 ✗ (n=3314)    | 0.745 ✗ (n=3314)    | 0.745 ✗ (n=3314)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-zh.ascend                | 0.604 · (n=1982)    | 0.604 · (n=1982)    | 0.615 · (n=1982)    | report                                  | ascend      |
| A2.en-zh.edacc                 | 0.982 · (n=1228)    | 0.981 · (n=1228)    | 0.981 · (n=1228)    | report                                  | edacc       |
| A2.en-zh.err_after_fallback    | 0.255 ✗ (n=3314)    | 0.255 ✗ (n=3314)    | 0.249 ✗ (n=3314)    | <=0.05                                  | real+cv     |
| A2.en-zh.rerecorded            | 0.635 · (n=104)     | 0.635 · (n=104)     | 0.635 · (n=104)     | report                                  | rerecorded  |
| A2.vi-zh                       | 0.775 ✗ (n=524)     | 0.775 ✗ (n=524)     | 0.775 ✗ (n=524)     | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.vi-zh.ascend                | 1.000 · (n=152)     | 1.000 · (n=152)     | 1.000 · (n=152)     | report                                  | ascend      |
| A2.vi-zh.err_after_fallback    | 0.225 ✗ (n=524)     | 0.219 ✗ (n=524)     | 0.219 ✗ (n=524)     | <=0.05                                  | real+cv     |
| A2.vi-zh.rerecorded            | 0.933 · (n=60)      | 0.933 · (n=60)      | 0.933 · (n=60)      | report                                  | rerecorded  |
| A2.vi-zh.vietmed               | 1.000 · (n=6)       | 0.833 · (n=6)       | 0.833 · (n=6)       | report                                  | vietmed     |
| A2.vi-zh.vietmed-cut           | 0.633 · (n=300)     | 0.647 · (n=300)     | 0.647 · (n=300)     | report                                  | vietmed-cut |
| A2.vi-zh.vimedcss              | 0.333 · (n=6)       | 0.333 · (n=6)       | 0.333 · (n=6)       | report                                  | vimedcss    |
| A3.long.vien                   | 0.968 ✓ (n=3941)    | 0.967 ✓ (n=3941)    | 0.970 ✓ (n=3941)    | >=0.95                                  | real        |
| A3.long.zh                     | 0.985 ✓ (n=1135)    | 0.985 ✓ (n=1135)    | 0.984 ✓ (n=1135)    | >=0.95                                  | mixed       |
| A3.short.vien                  | 0.930 ✓ (n=1505)    | 0.928 ✓ (n=1505)    | 0.928 ✓ (n=1505)    | >=0.85                                  | real        |
| A3.short.zh                    | 0.468 ✗ (n=765)     | 0.468 ✗ (n=765)     | 0.480 ✗ (n=765)     | >=0.85                                  | real        |
| A4                             | 0.943 ✗ (n=1833)    | 0.944 ✗ (n=1833)    | 0.944 ✗ (n=1833)    | >=0.95                                  | real        |
| A5                             | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | >=0.90 rejected                         | esc50+real  |
| A5.esc50                       | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| A5.real                        | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| A6.en-vi.changed               | 0.114 ✗ (n=6758)    | 0.116 ✗ (n=6758)    | 0.116 ✗ (n=6758)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 3226.490 ✓ (n=7662) | 3226.490 ✓ (n=7662) | 3226.490 ✓ (n=7662) | <=3500                                  | real        |
| A6.en-zh.changed               | 0.016 ✓ (n=6428)    | 0.015 ✓ (n=6428)    | 0.015 ✓ (n=6428)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 3189.980 ✓ (n=7648) | 3189.980 ✓ (n=7648) | 3189.980 ✓ (n=7648) | <=3500                                  | mixed       |
| A6.vi-zh.changed               | 0.121 ✗ (n=3952)    | 0.120 ✗ (n=3952)    | 0.120 ✗ (n=3952)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 3194.280 ✓ (n=4016) | 3194.280 ✓ (n=4016) | 3194.280 ✓ (n=4016) | <=3500                                  | mixed       |
| A7                             | 243.773 ✗ (n=29672) | 243.773 ✗ (n=29672) | 243.773 ✗ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.010 ✓ (n=200)     | 0.010 ✓ (n=200)     | 0.010 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.836 · (n=5243)    | 0.836 · (n=5243)    | 0.836 · (n=5243)    | report                                  | real        |
| lock.en-zh.accuracy            | 0.970 · (n=3866)    | 0.970 · (n=3866)    | 0.970 · (n=3866)    | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.845 · (n=3410)    | 0.845 · (n=3410)    | 0.845 · (n=3410)    | report                                  | mixed       |
| zh_real.A1.en-zh               | 0.975 · (n=1270)    | 0.975 · (n=1270)    | 0.974 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh               | 1.000 · (n=150)     | 1.000 · (n=150)     | 1.000 · (n=150)     | report                                  | real        |
| zh_real.A3                     | 0.697 · (n=1400)    | 0.697 · (n=1400)    | 0.703 · (n=1400)    | report                                  | real        |
