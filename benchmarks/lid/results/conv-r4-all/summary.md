# LID bake-off `conv-r4-all`

Outcome: **G3**, winner `whisper_probs_base_ctx5`

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
| A6.en-vi.changed               | 0.067 ✓ (n=6758)    | 0.066 ✓ (n=6758)    | 0.066 ✓ (n=6758)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 2029.670 ✓ (n=7662) | 2029.670 ✓ (n=7662) | 2029.670 ✓ (n=7662) | <=3500                                  | real        |
| A6.en-zh.changed               | 0.055 ✓ (n=6428)    | 0.056 ✓ (n=6428)    | 0.056 ✓ (n=6428)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 2028.320 ✓ (n=7648) | 2028.320 ✓ (n=7648) | 2028.320 ✓ (n=7648) | <=3500                                  | mixed       |
| A6.vi-zh.changed               | 0.028 ✓ (n=3952)    | 0.028 ✓ (n=3952)    | 0.028 ✓ (n=3952)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 2028.420 ✓ (n=4016) | 2028.420 ✓ (n=4016) | 2028.420 ✓ (n=4016) | <=3500                                  | mixed       |
| A7                             | 239.883 ✗ (n=29672) | 239.883 ✗ (n=29672) | 239.883 ✗ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.100 ✗ (n=200)     | 0.110 ✗ (n=200)     | 0.120 ✗ (n=200)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.914 · (n=6149)    | 0.914 · (n=6149)    | 0.914 · (n=6149)    | report                                  | real        |
| lock.en-zh.accuracy            | 0.923 · (n=5092)    | 0.923 · (n=5092)    | 0.923 · (n=5092)    | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.968 · (n=3746)    | 0.968 · (n=3746)    | 0.968 · (n=3746)    | report                                  | mixed       |
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
| A6.en-vi.changed               | 0.070 ✓ (n=6758)     | 0.074 ✓ (n=6758)     | 0.073 ✓ (n=6758)     | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 2420.763 ✓ (n=7662)  | 2420.763 ✓ (n=7662)  | 2420.763 ✓ (n=7662)  | <=3500                                  | real        |
| A6.en-zh.changed               | 0.049 ✓ (n=6428)     | 0.052 ✓ (n=6428)     | 0.052 ✓ (n=6428)     | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 2394.160 ✓ (n=7648)  | 2394.160 ✓ (n=7648)  | 2394.160 ✓ (n=7648)  | <=3500                                  | mixed       |
| A6.vi-zh.changed               | 0.023 ✓ (n=3952)     | 0.023 ✓ (n=3952)     | 0.023 ✓ (n=3952)     | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 2210.520 ✓ (n=4016)  | 2210.520 ✓ (n=4016)  | 2210.520 ✓ (n=4016)  | <=3500                                  | mixed       |
| A7                             | 2311.370 ✗ (n=29672) | 2311.370 ✗ (n=29672) | 2311.370 ✗ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.170 ✗ (n=200)      | 0.090 ✗ (n=200)      | 0.150 ✗ (n=200)      | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.000 ✓ (n=200)      | 0.000 ✓ (n=200)      | 0.000 ✓ (n=200)      | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.896 · (n=6054)     | 0.896 · (n=6054)     | 0.896 · (n=6054)     | report                                  | real        |
| lock.en-zh.accuracy            | 0.928 · (n=5440)     | 0.928 · (n=5440)     | 0.928 · (n=5440)     | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.974 · (n=3744)     | 0.974 · (n=3744)     | 0.974 · (n=3744)     | report                                  | mixed       |
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
| A6.en-vi.changed               | 0.042 ✓ (n=6758)    | 0.042 ✓ (n=6758)    | 0.042 ✓ (n=6758)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 4400.000 ✗ (n=7662) | 4400.000 ✗ (n=7662) | 4400.000 ✗ (n=7662) | <=3500                                  | real        |
| A6.en-zh.changed               | 0.060 ✓ (n=6428)    | 0.060 ✓ (n=6428)    | 0.060 ✓ (n=6428)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 4340.000 ✗ (n=7648) | 4340.000 ✗ (n=7648) | 4340.000 ✗ (n=7648) | <=3500                                  | mixed       |
| A6.vi-zh.changed               | 0.049 ✓ (n=3952)    | 0.049 ✓ (n=3952)    | 0.049 ✓ (n=3952)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 6420.000 ✗ (n=4016) | 6420.000 ✗ (n=4016) | 6420.000 ✗ (n=4016) | <=3500                                  | mixed       |
| A7                             | 257.039 ✗ (n=29672) | 257.039 ✗ (n=29672) | 257.039 ✗ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.030 ✗ (n=200)     | 0.030 ✗ (n=200)     | 0.030 ✗ (n=200)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.010 ✓ (n=200)     | 0.010 ✓ (n=200)     | 0.010 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.943 · (n=4809)    | 0.943 · (n=4809)    | 0.943 · (n=4809)    | report                                  | real        |
| lock.en-zh.accuracy            | 0.884 · (n=3126)    | 0.884 · (n=3126)    | 0.884 · (n=3126)    | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.934 · (n=2888)    | 0.934 · (n=2888)    | 0.934 · (n=2888)    | report                                  | mixed       |
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
| A6.en-vi.changed               | 0.074 ✓ (n=6758)    | 0.076 ✓ (n=6758)    | 0.074 ✓ (n=6758)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 3347.850 ✓ (n=7662) | 3347.850 ✓ (n=7662) | 3347.850 ✓ (n=7662) | <=3500                                  | real        |
| A6.en-zh.changed               | 0.011 ✓ (n=6428)    | 0.010 ✓ (n=6428)    | 0.010 ✓ (n=6428)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 3337.840 ✓ (n=7648) | 3340.460 ✓ (n=7648) | 3340.460 ✓ (n=7648) | <=3500                                  | mixed       |
| A6.vi-zh.changed               | 0.046 ✓ (n=3952)    | 0.047 ✓ (n=3952)    | 0.048 ✓ (n=3952)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 3352.710 ✓ (n=4016) | 3354.760 ✓ (n=4016) | 3354.760 ✓ (n=4016) | <=3500                                  | mixed       |
| A7                             | 358.250 ✗ (n=29672) | 358.250 ✗ (n=29672) | 358.250 ✗ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.896 · (n=5293)    | 0.896 · (n=5293)    | 0.896 · (n=5293)    | report                                  | real        |
| lock.en-zh.accuracy            | 0.981 · (n=3886)    | 0.981 · (n=3876)    | 0.981 · (n=3876)    | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.942 · (n=3390)    | 0.941 · (n=3382)    | 0.941 · (n=3382)    | report                                  | mixed       |
| zh_real.A1.en-zh               | 0.978 · (n=1270)    | 0.980 · (n=1270)    | 0.978 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh               | 0.987 · (n=150)     | 0.980 · (n=150)     | 0.987 · (n=150)     | report                                  | real        |
| zh_real.A3                     | 0.701 · (n=1400)    | 0.706 · (n=1400)    | 0.707 · (n=1400)    | report                                  | real        |

## whisper_probs_base_ctx (cv None, tau_noise 0.0)

| criterion                      | bare                | src                 | src+voice           | threshold                               | data        |
| ------------------------------ | ------------------- | ------------------- | ------------------- | --------------------------------------- | ----------- |
| A-ACC.detect                   | 0.967 ✓ (n=604)     | 0.964 ✓ (n=604)     | 0.967 ✓ (n=604)     | >=0.95                                  | public      |
| A-ACC.pair                     | 0.979 ✓ (n=616)     | 0.977 ✓ (n=616)     | 0.979 ✓ (n=616)     | >=0.95                                  | public      |
| A1.en-vi                       | 0.986 ✓ (n=5612)    | 0.985 ✓ (n=5612)    | 0.985 ✓ (n=5612)    | >=0.97                                  | real        |
| A1.en-zh                       | 0.985 ✓ (n=4334)    | 0.984 ✓ (n=4334)    | 0.984 ✓ (n=4334)    | >=0.97                                  | mixed       |
| A1.vi-zh                       | 0.987 ✓ (n=3492)    | 0.986 ✓ (n=3492)    | 0.986 ✓ (n=3492)    | >=0.97                                  | mixed       |
| A2.en-vi                       | 0.933 ✓ (n=2050)    | 0.933 ✓ (n=2050)    | 0.933 ✓ (n=2050)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-vi.edacc                 | 0.979 · (n=1682)    | 0.974 · (n=1682)    | 0.973 · (n=1682)    | report                                  | edacc       |
| A2.en-vi.err_after_fallback    | 0.067 ✗ (n=2050)    | 0.074 ✗ (n=2050)    | 0.075 ✗ (n=2050)    | <=0.05                                  | real+cv     |
| A2.en-vi.rerecorded            | 0.893 · (n=56)      | 0.911 · (n=56)      | 0.911 · (n=56)      | report                                  | rerecorded  |
| A2.en-vi.vietmed               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vietmed     |
| A2.en-vi.vietmed-cut           | 0.693 · (n=300)     | 0.670 · (n=300)     | 0.670 · (n=300)     | report                                  | vietmed-cut |
| A2.en-vi.vimedcss              | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| A2.en-zh                       | 0.737 ✗ (n=3314)    | 0.737 ✗ (n=3314)    | 0.737 ✗ (n=3314)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-zh.ascend                | 0.642 · (n=1982)    | 0.642 · (n=1982)    | 0.642 · (n=1982)    | report                                  | ascend      |
| A2.en-zh.edacc                 | 0.894 · (n=1228)    | 0.877 · (n=1228)    | 0.879 · (n=1228)    | report                                  | edacc       |
| A2.en-zh.err_after_fallback    | 0.263 ✗ (n=3314)    | 0.268 ✗ (n=3314)    | 0.267 ✗ (n=3314)    | <=0.05                                  | real+cv     |
| A2.en-zh.rerecorded            | 0.712 · (n=104)     | 0.740 · (n=104)     | 0.740 · (n=104)     | report                                  | rerecorded  |
| A2.vi-zh                       | 0.771 ✗ (n=524)     | 0.771 ✗ (n=524)     | 0.771 ✗ (n=524)     | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.vi-zh.ascend                | 0.974 · (n=152)     | 0.974 · (n=152)     | 0.974 · (n=152)     | report                                  | ascend      |
| A2.vi-zh.err_after_fallback    | 0.229 ✗ (n=524)     | 0.225 ✗ (n=524)     | 0.225 ✗ (n=524)     | <=0.05                                  | real+cv     |
| A2.vi-zh.rerecorded            | 0.933 · (n=60)      | 0.867 · (n=60)      | 0.867 · (n=60)      | report                                  | rerecorded  |
| A2.vi-zh.vietmed               | 0.667 · (n=6)       | 0.833 · (n=6)       | 0.833 · (n=6)       | report                                  | vietmed     |
| A2.vi-zh.vietmed-cut           | 0.640 · (n=300)     | 0.657 · (n=300)     | 0.657 · (n=300)     | report                                  | vietmed-cut |
| A2.vi-zh.vimedcss              | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| A3.long.vien                   | 0.979 ✓ (n=3941)    | 0.978 ✓ (n=3941)    | 0.979 ✓ (n=3941)    | >=0.95                                  | real        |
| A3.long.zh                     | 0.988 ✓ (n=1135)    | 0.988 ✓ (n=1135)    | 0.988 ✓ (n=1135)    | >=0.95                                  | mixed       |
| A3.short.vien                  | 0.835 ✗ (n=1505)    | 0.837 ✗ (n=1505)    | 0.835 ✗ (n=1505)    | >=0.85                                  | real        |
| A3.short.zh                    | 0.574 ✗ (n=765)     | 0.574 ✗ (n=765)     | 0.574 ✗ (n=765)     | >=0.85                                  | real        |
| A4                             | 0.964 ✓ (n=1833)    | 0.963 ✓ (n=1833)    | 0.963 ✓ (n=1833)    | >=0.95                                  | real        |
| A5                             | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | >=0.90 rejected                         | esc50+real  |
| A5.esc50                       | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| A5.real                        | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| A6.en-vi.changed               | 0.075 ✓ (n=6758)    | 0.073 ✓ (n=6758)    | 0.073 ✓ (n=6758)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 3098.660 ✓ (n=7662) | 3099.220 ✓ (n=7662) | 3099.220 ✓ (n=7662) | <=3500                                  | real        |
| A6.en-zh.changed               | 0.011 ✓ (n=6428)    | 0.011 ✓ (n=6428)    | 0.011 ✓ (n=6428)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 3095.030 ✓ (n=7648) | 3095.030 ✓ (n=7648) | 3095.030 ✓ (n=7648) | <=3500                                  | mixed       |
| A6.vi-zh.changed               | 0.091 ✓ (n=3952)    | 0.083 ✓ (n=3952)    | 0.083 ✓ (n=3952)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 3094.000 ✓ (n=4016) | 3095.380 ✓ (n=4016) | 3095.380 ✓ (n=4016) | <=3500                                  | mixed       |
| A7                             | 139.504 ✓ (n=29672) | 139.504 ✓ (n=29672) | 139.504 ✓ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.010 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.892 · (n=5162)    | 0.896 · (n=5152)    | 0.896 · (n=5152)    | report                                  | real        |
| lock.en-zh.accuracy            | 0.977 · (n=3666)    | 0.977 · (n=3666)    | 0.977 · (n=3666)    | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.886 · (n=3398)    | 0.895 · (n=3376)    | 0.895 · (n=3376)    | report                                  | mixed       |
| zh_real.A1.en-zh               | 0.978 · (n=1270)    | 0.978 · (n=1270)    | 0.978 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh               | 1.000 · (n=150)     | 0.993 · (n=150)     | 0.993 · (n=150)     | report                                  | real        |
| zh_real.A3                     | 0.757 · (n=1400)    | 0.757 · (n=1400)    | 0.757 · (n=1400)    | report                                  | real        |

## whisper_probs_base_ctx5 (cv None, tau_noise 0.0)

| criterion                      | bare                | src                 | src+voice           | threshold                               | data        |
| ------------------------------ | ------------------- | ------------------- | ------------------- | --------------------------------------- | ----------- |
| A-ACC.detect                   | 0.967 ✓ (n=604)     | 0.964 ✓ (n=604)     | 0.980 ✓ (n=604)     | >=0.95                                  | public      |
| A-ACC.pair                     | 0.976 ✓ (n=616)     | 0.976 ✓ (n=616)     | 0.984 ✓ (n=616)     | >=0.95                                  | public      |
| A1.en-vi                       | 0.985 ✓ (n=5612)    | 0.985 ✓ (n=5612)    | 0.986 ✓ (n=5612)    | >=0.97                                  | real        |
| A1.en-zh                       | 0.989 ✓ (n=4334)    | 0.989 ✓ (n=4334)    | 0.987 ✓ (n=4334)    | >=0.97                                  | mixed       |
| A1.vi-zh                       | 0.986 ✓ (n=3492)    | 0.986 ✓ (n=3492)    | 0.986 ✓ (n=3492)    | >=0.97                                  | mixed       |
| A2.en-vi                       | 0.952 ✓ (n=2050)    | 0.952 ✓ (n=2050)    | 0.952 ✓ (n=2050)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-vi.edacc                 | 0.995 · (n=1682)    | 0.993 · (n=1682)    | 0.989 · (n=1682)    | report                                  | edacc       |
| A2.en-vi.err_after_fallback    | 0.048 ✓ (n=2050)    | 0.051 ✗ (n=2050)    | 0.054 ✗ (n=2050)    | <=0.05                                  | real+cv     |
| A2.en-vi.rerecorded            | 0.929 · (n=56)      | 0.946 · (n=56)      | 0.946 · (n=56)      | report                                  | rerecorded  |
| A2.en-vi.vietmed               | 1.000 · (n=6)       | 0.833 · (n=6)       | 0.833 · (n=6)       | report                                  | vietmed     |
| A2.en-vi.vietmed-cut           | 0.720 · (n=300)     | 0.710 · (n=300)     | 0.710 · (n=300)     | report                                  | vietmed-cut |
| A2.en-vi.vimedcss              | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| A2.en-zh                       | 0.769 ✗ (n=3314)    | 0.769 ✗ (n=3314)    | 0.769 ✗ (n=3314)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-zh.ascend                | 0.663 · (n=1982)    | 0.663 · (n=1982)    | 0.663 · (n=1982)    | report                                  | ascend      |
| A2.en-zh.edacc                 | 0.943 · (n=1228)    | 0.940 · (n=1228)    | 0.900 · (n=1228)    | report                                  | edacc       |
| A2.en-zh.err_after_fallback    | 0.231 ✗ (n=3314)    | 0.231 ✗ (n=3314)    | 0.246 ✗ (n=3314)    | <=0.05                                  | real+cv     |
| A2.en-zh.rerecorded            | 0.750 · (n=104)     | 0.760 · (n=104)     | 0.760 · (n=104)     | report                                  | rerecorded  |
| A2.vi-zh                       | 0.813 ✗ (n=524)     | 0.813 ✗ (n=524)     | 0.813 ✗ (n=524)     | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.vi-zh.ascend                | 0.987 · (n=152)     | 0.987 · (n=152)     | 0.987 · (n=152)     | report                                  | ascend      |
| A2.vi-zh.err_after_fallback    | 0.187 ✗ (n=524)     | 0.187 ✗ (n=524)     | 0.187 ✗ (n=524)     | <=0.05                                  | real+cv     |
| A2.vi-zh.rerecorded            | 0.933 · (n=60)      | 0.917 · (n=60)      | 0.917 · (n=60)      | report                                  | rerecorded  |
| A2.vi-zh.vietmed               | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| A2.vi-zh.vietmed-cut           | 0.700 · (n=300)     | 0.703 · (n=300)     | 0.703 · (n=300)     | report                                  | vietmed-cut |
| A2.vi-zh.vimedcss              | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| A3.long.vien                   | 0.980 ✓ (n=3941)    | 0.979 ✓ (n=3941)    | 0.983 ✓ (n=3941)    | >=0.95                                  | real        |
| A3.long.zh                     | 0.992 ✓ (n=1135)    | 0.992 ✓ (n=1135)    | 0.992 ✓ (n=1135)    | >=0.95                                  | mixed       |
| A3.short.vien                  | 0.892 ✓ (n=1505)    | 0.892 ✓ (n=1505)    | 0.896 ✓ (n=1505)    | >=0.85                                  | real        |
| A3.short.zh                    | 0.569 ✗ (n=765)     | 0.569 ✗ (n=765)     | 0.569 ✗ (n=765)     | >=0.85                                  | real        |
| A4                             | 0.963 ✓ (n=1833)    | 0.963 ✓ (n=1833)    | 0.963 ✓ (n=1833)    | >=0.95                                  | real        |
| A5                             | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | >=0.90 rejected                         | esc50+real  |
| A5.esc50                       | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| A5.real                        | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| A6.en-vi.changed               | 0.071 ✓ (n=6758)    | 0.070 ✓ (n=6758)    | 0.070 ✓ (n=6758)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 3098.460 ✓ (n=7662) | 3098.460 ✓ (n=7662) | 3098.460 ✓ (n=7662) | <=3500                                  | real        |
| A6.en-zh.changed               | 0.010 ✓ (n=6428)    | 0.009 ✓ (n=6428)    | 0.009 ✓ (n=6428)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 3091.410 ✓ (n=7648) | 3091.410 ✓ (n=7648) | 3091.720 ✓ (n=7648) | <=3500                                  | mixed       |
| A6.vi-zh.changed               | 0.085 ✓ (n=3952)    | 0.084 ✓ (n=3952)    | 0.084 ✓ (n=3952)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 3090.920 ✓ (n=4016) | 3090.920 ✓ (n=4016) | 3090.920 ✓ (n=4016) | <=3500                                  | mixed       |
| A7                             | 125.710 ✓ (n=29672) | 125.710 ✓ (n=29672) | 125.710 ✓ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.010 ✓ (n=200)     | 0.010 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.900 · (n=5239)    | 0.900 · (n=5239)    | 0.900 · (n=5239)    | report                                  | real        |
| lock.en-zh.accuracy            | 0.981 · (n=3816)    | 0.981 · (n=3816)    | 0.982 · (n=3804)    | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.897 · (n=3410)    | 0.897 · (n=3410)    | 0.897 · (n=3410)    | report                                  | mixed       |
| zh_real.A1.en-zh               | 0.986 · (n=1270)    | 0.986 · (n=1270)    | 0.986 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh               | 1.000 · (n=150)     | 1.000 · (n=150)     | 1.000 · (n=150)     | report                                  | real        |
| zh_real.A3                     | 0.758 · (n=1400)    | 0.758 · (n=1400)    | 0.758 · (n=1400)    | report                                  | real        |

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
| A6.en-vi.changed               | 0.083 ✓ (n=6758)    | 0.084 ✓ (n=6758)    | 0.084 ✓ (n=6758)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 3236.509 ✓ (n=7662) | 3236.509 ✓ (n=7662) | 3236.509 ✓ (n=7662) | <=3500                                  | real        |
| A6.en-zh.changed               | 0.009 ✓ (n=6428)    | 0.009 ✓ (n=6428)    | 0.008 ✓ (n=6428)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 3198.450 ✓ (n=7648) | 3198.450 ✓ (n=7648) | 3198.450 ✓ (n=7648) | <=3500                                  | mixed       |
| A6.vi-zh.changed               | 0.076 ✓ (n=3952)    | 0.075 ✓ (n=3952)    | 0.075 ✓ (n=3952)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 3238.740 ✓ (n=4016) | 3238.740 ✓ (n=4016) | 3238.740 ✓ (n=4016) | <=3500                                  | mixed       |
| A7                             | 243.773 ✗ (n=29672) | 243.773 ✗ (n=29672) | 243.773 ✗ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.010 ✓ (n=200)     | 0.010 ✓ (n=200)     | 0.010 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.874 · (n=5124)    | 0.874 · (n=5124)    | 0.874 · (n=5124)    | report                                  | real        |
| lock.en-zh.accuracy            | 0.981 · (n=3782)    | 0.981 · (n=3782)    | 0.981 · (n=3782)    | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.892 · (n=3252)    | 0.892 · (n=3252)    | 0.892 · (n=3252)    | report                                  | mixed       |
| zh_real.A1.en-zh               | 0.975 · (n=1270)    | 0.975 · (n=1270)    | 0.974 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh               | 1.000 · (n=150)     | 1.000 · (n=150)     | 1.000 · (n=150)     | report                                  | real        |
| zh_real.A3                     | 0.697 · (n=1400)    | 0.697 · (n=1400)    | 0.703 · (n=1400)    | report                                  | real        |
