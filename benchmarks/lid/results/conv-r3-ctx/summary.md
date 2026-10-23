# LID bake-off `conv-r3-ctx`

Outcome: **INCOMPLETE**

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
| A6.en-vi.changed               | 0.117 ✗ (n=6758)    | 0.117 ✗ (n=6758)    | 0.117 ✗ (n=6758)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms | 3096.820 ✓ (n=7662) | 3096.820 ✓ (n=7662) | 3096.820 ✓ (n=7662) | <=3500                                  | real        |
| A6.en-zh.changed               | 0.025 ✓ (n=6428)    | 0.025 ✓ (n=6428)    | 0.025 ✓ (n=6428)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms | 3087.800 ✓ (n=7648) | 3087.800 ✓ (n=7648) | 3087.800 ✓ (n=7648) | <=3500                                  | mixed       |
| A6.vi-zh.changed               | 0.152 ✗ (n=3952)    | 0.153 ✗ (n=3952)    | 0.153 ✗ (n=3952)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms | 3098.950 ✓ (n=4016) | 3098.950 ✓ (n=4016) | 3098.950 ✓ (n=4016) | <=3500                                  | mixed       |
| A7                             | 139.504 ✓ (n=29672) | 139.504 ✓ (n=29672) | 139.504 ✓ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                     | 0.010 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| lock.en-vi.accuracy            | 0.834 · (n=5315)    | 0.834 · (n=5315)    | 0.834 · (n=5315)    | report                                  | real        |
| lock.en-zh.accuracy            | 0.952 · (n=3868)    | 0.952 · (n=3868)    | 0.952 · (n=3868)    | report                                  | mixed       |
| lock.vi-zh.accuracy            | 0.804 · (n=3414)    | 0.804 · (n=3414)    | 0.804 · (n=3414)    | report                                  | mixed       |
| zh_real.A1.en-zh               | 0.978 · (n=1270)    | 0.978 · (n=1270)    | 0.978 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh               | 1.000 · (n=150)     | 0.993 · (n=150)     | 0.993 · (n=150)     | report                                  | real        |
| zh_real.A3                     | 0.757 · (n=1400)    | 0.757 · (n=1400)    | 0.757 · (n=1400)    | report                                  | real        |
