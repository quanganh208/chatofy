# LID bake-off `conv-r4-head` (ruler v5)

Outcome: **INCOMPLETE**

## whisper_head (cv logo, tau_noise 0.0)

| criterion                          | bare                | src                 | src+voice           | threshold                               | data        |
| ---------------------------------- | ------------------- | ------------------- | ------------------- | --------------------------------------- | ----------- |
| A-ACC.detect                       | 0.854 ✗ (n=604)     | 0.854 ✗ (n=604)     | 0.854 ✗ (n=604)     | >=0.95                                  | public      |
| A-ACC.pair                         | 0.856 ✗ (n=616)     | 0.856 ✗ (n=616)     | 0.856 ✗ (n=616)     | >=0.95                                  | public      |
| A1.en-vi                           | 0.963 ✗ (n=5586)    | 0.963 ✗ (n=5586)    | 0.963 ✗ (n=5586)    | >=0.97                                  | real        |
| A1.en-zh                           | 0.946 ✗ (n=4332)    | 0.945 ✗ (n=4332)    | 0.945 ✗ (n=4332)    | >=0.97                                  | mixed       |
| A1.vi-zh                           | 0.991 ✓ (n=3468)    | 0.991 ✓ (n=3468)    | 0.991 ✓ (n=3468)    | >=0.97                                  | mixed       |
| A2.en-vi                           | 0.860 ✗ (n=1227)    | 0.860 ✗ (n=1227)    | 0.860 ✗ (n=1227)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-vi.edacc                     | 0.886 · (n=911)     | 0.872 · (n=911)     | 0.872 · (n=911)     | report                                  | edacc       |
| A2.en-vi.err_after_fallback        | 0.140 ✗ (n=1227)    | 0.151 ✗ (n=1227)    | 0.151 ✗ (n=1227)    | <=0.05                                  | real+cv     |
| A2.en-vi.rerecorded                | 0.750 · (n=24)      | 0.750 · (n=24)      | 0.750 · (n=24)      | report                                  | rerecorded  |
| A2.en-vi.vietmed                   | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| A2.en-vi.vietmed-cut               | 0.780 · (n=282)     | 0.780 · (n=282)     | 0.780 · (n=282)     | report                                  | vietmed-cut |
| A2.en-vi.vimedcss                  | 1.000 · (n=4)       | 1.000 · (n=4)       | 1.000 · (n=4)       | report                                  | vimedcss    |
| A2.en-zh                           | 0.593 ✗ (n=2094)    | 0.593 ✗ (n=2094)    | 0.593 ✗ (n=2094)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-zh.ascend                    | 0.534 · (n=1374)    | 0.534 · (n=1374)    | 0.534 · (n=1374)    | report                                  | ascend      |
| A2.en-zh.edacc                     | 0.728 · (n=676)     | 0.728 · (n=676)     | 0.728 · (n=676)     | report                                  | edacc       |
| A2.en-zh.err_after_fallback        | 0.407 ✗ (n=2094)    | 0.407 ✗ (n=2094)    | 0.407 ✗ (n=2094)    | <=0.05                                  | real+cv     |
| A2.en-zh.rerecorded                | 0.364 · (n=44)      | 0.364 · (n=44)      | 0.364 · (n=44)      | report                                  | rerecorded  |
| A2.vi-zh                           | 0.700 ✗ (n=440)     | 0.700 ✗ (n=440)     | 0.700 ✗ (n=440)     | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.vi-zh.ascend                    | 0.828 · (n=116)     | 0.828 · (n=116)     | 0.828 · (n=116)     | report                                  | ascend      |
| A2.vi-zh.err_after_fallback        | 0.300 ✗ (n=440)     | 0.300 ✗ (n=440)     | 0.300 ✗ (n=440)     | <=0.05                                  | real+cv     |
| A2.vi-zh.rerecorded                | 0.562 · (n=32)      | 0.562 · (n=32)      | 0.562 · (n=32)      | report                                  | rerecorded  |
| A2.vi-zh.vietmed                   | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vietmed     |
| A2.vi-zh.vietmed-cut               | 0.667 · (n=282)     | 0.667 · (n=282)     | 0.667 · (n=282)     | report                                  | vietmed-cut |
| A2.vi-zh.vimedcss                  | 0.500 · (n=4)       | 0.500 · (n=4)       | 0.500 · (n=4)       | report                                  | vimedcss    |
| A3.long.by_lang.en                 | 0.913 · (n=1623)    | 0.913 · (n=1623)    | 0.913 · (n=1623)    | report                                  | real        |
| A3.long.by_lang.vi                 | 0.993 · (n=2305)    | 0.993 · (n=2305)    | 0.993 · (n=2305)    | report                                  | real        |
| A3.long.by_lang.zh                 | 0.830 · (n=635)     | 0.830 · (n=635)     | 0.830 · (n=635)     | report                                  | real        |
| A3.long.vien                       | 0.960 ✓ (n=3928)    | 0.960 ✓ (n=3928)    | 0.960 ✓ (n=3928)    | >=0.95                                  | real        |
| A3.long.zh                         | 0.900 ✗ (n=1135)    | 0.900 ✗ (n=1135)    | 0.900 ✗ (n=1135)    | >=0.95                                  | mixed       |
| A3.short.by_lang.en                | 0.754 · (n=790)     | 0.754 · (n=790)     | 0.754 · (n=790)     | report                                  | real        |
| A3.short.by_lang.en.ascend         | 0.995 · (n=208)     | 0.995 · (n=208)     | 0.995 · (n=208)     | report                                  | ascend      |
| A3.short.by_lang.en.edacc          | 0.668 · (n=573)     | 0.668 · (n=573)     | 0.668 · (n=573)     | report                                  | edacc       |
| A3.short.by_lang.en.rerecorded     | 0.667 · (n=9)       | 0.667 · (n=9)       | 0.667 · (n=9)       | report                                  | rerecorded  |
| A3.short.by_lang.vi                | 0.584 · (n=149)     | 0.584 · (n=149)     | 0.584 · (n=149)     | report                                  | real        |
| A3.short.by_lang.vi.rerecorded     | 0.000 · (n=3)       | 0.000 · (n=3)       | 0.000 · (n=3)       | report                                  | rerecorded  |
| A3.short.by_lang.vi.vietmed        | 0.667 · (n=3)       | 0.667 · (n=3)       | 0.667 · (n=3)       | report                                  | vietmed     |
| A3.short.by_lang.vi.vietmed-cut    | 0.596 · (n=141)     | 0.596 · (n=141)     | 0.596 · (n=141)     | report                                  | vietmed-cut |
| A3.short.by_lang.vi.vimedcss       | 0.500 · (n=2)       | 0.500 · (n=2)       | 0.500 · (n=2)       | report                                  | vimedcss    |
| A3.short.by_lang.zh                | 0.307 · (n=492)     | 0.307 · (n=492)     | 0.307 · (n=492)     | report                                  | real        |
| A3.short.by_lang.zh.ascend         | 0.313 · (n=479)     | 0.313 · (n=479)     | 0.313 · (n=479)     | report                                  | ascend      |
| A3.short.by_lang.zh.rerecorded     | 0.077 · (n=13)      | 0.077 · (n=13)      | 0.077 · (n=13)      | report                                  | rerecorded  |
| A3.short.vien                      | 0.727 ✗ (n=939)     | 0.727 ✗ (n=939)     | 0.727 ✗ (n=939)     | >=0.85                                  | real        |
| A3.short.zh                        | 0.307 ✗ (n=492)     | 0.307 ✗ (n=492)     | 0.307 ✗ (n=492)     | >=0.85                                  | real        |
| A4                                 | 0.978 ✓ (n=1833)    | 0.978 ✓ (n=1833)    | 0.978 ✓ (n=1833)    | >=0.95                                  | real        |
| A5                                 | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | >=0.90 rejected                         | esc50+real  |
| A5.esc50                           | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| A5.real                            | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| A6.en-vi.changed                   | 0.087 ✓ (n=6618)    | 0.088 ✓ (n=6618)    | 0.088 ✓ (n=6618)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms     | 3111.610 ✓ (n=6813) | 3111.410 ✓ (n=6813) | 3111.410 ✓ (n=6813) | <=3500                                  | real        |
| A6.en-zh.changed                   | 0.050 ✓ (n=6156)    | 0.051 ✓ (n=6156)    | 0.051 ✓ (n=6156)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms     | 3105.295 ✓ (n=6426) | 3104.950 ✓ (n=6426) | 3104.950 ✓ (n=6426) | <=3500                                  | mixed       |
| A6.vi-zh.changed                   | 0.048 ✓ (n=3894)    | 0.048 ✓ (n=3894)    | 0.048 ✓ (n=3894)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms     | 3100.762 ✓ (n=3908) | 3100.762 ✓ (n=3908) | 3100.762 ✓ (n=3908) | <=3500                                  | mixed       |
| A7                                 | 125.710 ✓ (n=29672) | 125.710 ✓ (n=29672) | 125.710 ✓ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                         | 0.072 ✗ (n=138)     | 0.072 ✗ (n=138)     | 0.072 ✗ (n=138)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                         | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| detect2v3.short.en                 | -0.161 ✗ (n=790)    | -0.161 ✗ (n=790)    | -0.161 ✗ (n=790)    | >=-0.02                                 | real        |
| detect2v3.short.vi                 | -0.188 ✗ (n=149)    | -0.188 ✗ (n=149)    | -0.188 ✗ (n=149)    | >=-0.02                                 | real        |
| excluded.en                        | 0.188 · (n=2970)    | 0.188 · (n=2970)    | 0.188 · (n=2970)    | report                                  | real        |
| excluded.vi                        | 0.009 · (n=2476)    | 0.009 · (n=2476)    | 0.009 · (n=2476)    | report                                  | real        |
| excluded.zh                        | 0.195 · (n=1400)    | 0.195 · (n=1400)    | 0.195 · (n=1400)    | report                                  | real        |
| lock.en-vi.accuracy                | 0.870 · (n=5009)    | 0.870 · (n=5011)    | 0.870 · (n=5011)    | report                                  | real        |
| lock.en-zh.accuracy                | 0.898 · (n=3610)    | 0.897 · (n=3606)    | 0.897 · (n=3606)    | report                                  | mixed       |
| lock.vi-zh.accuracy                | 0.942 · (n=3288)    | 0.942 · (n=3288)    | 0.942 · (n=3288)    | report                                  | mixed       |
| v4.A-ACC.detect                    | 0.854 · (n=604)     | 0.854 · (n=604)     | 0.854 · (n=604)     | report                                  | public      |
| v4.A-ACC.pair                      | 0.856 · (n=616)     | 0.856 · (n=616)     | 0.856 · (n=616)     | report                                  | public      |
| v4.A1.en-vi                        | 0.963 · (n=5612)    | 0.963 · (n=5612)    | 0.963 · (n=5612)    | report                                  | real        |
| v4.A1.en-zh                        | 0.946 · (n=4334)    | 0.945 · (n=4334)    | 0.945 · (n=4334)    | report                                  | mixed       |
| v4.A1.vi-zh                        | 0.991 · (n=3492)    | 0.991 · (n=3492)    | 0.991 · (n=3492)    | report                                  | mixed       |
| v4.A2.en-vi                        | 0.853 · (n=2050)    | 0.853 · (n=2050)    | 0.853 · (n=2050)    | report                                  | real+cv     |
| v4.A2.en-vi.edacc                  | 0.870 · (n=1682)    | 0.843 · (n=1682)    | 0.843 · (n=1682)    | report                                  | edacc       |
| v4.A2.en-vi.err_after_fallback     | 0.147 · (n=2050)    | 0.169 · (n=2050)    | 0.169 · (n=2050)    | report                                  | real+cv     |
| v4.A2.en-vi.rerecorded             | 0.893 · (n=56)      | 0.893 · (n=56)      | 0.893 · (n=56)      | report                                  | rerecorded  |
| v4.A2.en-vi.vietmed                | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| v4.A2.en-vi.vietmed-cut            | 0.753 · (n=300)     | 0.753 · (n=300)     | 0.753 · (n=300)     | report                                  | vietmed-cut |
| v4.A2.en-vi.vimedcss               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| v4.A2.en-zh                        | 0.453 · (n=3314)    | 0.453 · (n=3314)    | 0.453 · (n=3314)    | report                                  | real+cv     |
| v4.A2.en-zh.ascend                 | 0.420 · (n=1982)    | 0.420 · (n=1982)    | 0.420 · (n=1982)    | report                                  | ascend      |
| v4.A2.en-zh.edacc                  | 0.523 · (n=1228)    | 0.529 · (n=1228)    | 0.529 · (n=1228)    | report                                  | edacc       |
| v4.A2.en-zh.err_after_fallback     | 0.547 · (n=3314)    | 0.545 · (n=3314)    | 0.545 · (n=3314)    | report                                  | real+cv     |
| v4.A2.en-zh.rerecorded             | 0.250 · (n=104)     | 0.250 · (n=104)     | 0.250 · (n=104)     | report                                  | rerecorded  |
| v4.A2.vi-zh                        | 0.698 · (n=524)     | 0.698 · (n=524)     | 0.698 · (n=524)     | report                                  | real+cv     |
| v4.A2.vi-zh.ascend                 | 0.829 · (n=152)     | 0.829 · (n=152)     | 0.829 · (n=152)     | report                                  | ascend      |
| v4.A2.vi-zh.err_after_fallback     | 0.302 · (n=524)     | 0.302 · (n=524)     | 0.302 · (n=524)     | report                                  | real+cv     |
| v4.A2.vi-zh.rerecorded             | 0.633 · (n=60)      | 0.633 · (n=60)      | 0.633 · (n=60)      | report                                  | rerecorded  |
| v4.A2.vi-zh.vietmed                | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vietmed     |
| v4.A2.vi-zh.vietmed-cut            | 0.653 · (n=300)     | 0.653 · (n=300)     | 0.653 · (n=300)     | report                                  | vietmed-cut |
| v4.A2.vi-zh.vimedcss               | 0.333 · (n=6)       | 0.333 · (n=6)       | 0.333 · (n=6)       | report                                  | vimedcss    |
| v4.A3.long.by_lang.en              | 0.913 · (n=1624)    | 0.913 · (n=1624)    | 0.913 · (n=1624)    | report                                  | real        |
| v4.A3.long.by_lang.vi              | 0.993 · (n=2317)    | 0.993 · (n=2317)    | 0.993 · (n=2317)    | report                                  | real        |
| v4.A3.long.by_lang.zh              | 0.830 · (n=635)     | 0.830 · (n=635)     | 0.830 · (n=635)     | report                                  | real        |
| v4.A3.long.vien                    | 0.960 · (n=3941)    | 0.960 · (n=3941)    | 0.960 · (n=3941)    | report                                  | real        |
| v4.A3.long.zh                      | 0.900 · (n=1135)    | 0.900 · (n=1135)    | 0.900 · (n=1135)    | report                                  | mixed       |
| v4.A3.short.by_lang.en             | 0.577 · (n=1346)    | 0.577 · (n=1346)    | 0.577 · (n=1346)    | report                                  | real        |
| v4.A3.short.by_lang.en.ascend      | 0.992 · (n=253)     | 0.992 · (n=253)     | 0.992 · (n=253)     | report                                  | ascend      |
| v4.A3.short.by_lang.en.edacc       | 0.481 · (n=1068)    | 0.481 · (n=1068)    | 0.481 · (n=1068)    | report                                  | edacc       |
| v4.A3.short.by_lang.en.rerecorded  | 0.440 · (n=25)      | 0.440 · (n=25)      | 0.440 · (n=25)      | report                                  | rerecorded  |
| v4.A3.short.by_lang.vi             | 0.560 · (n=159)     | 0.560 · (n=159)     | 0.560 · (n=159)     | report                                  | real        |
| v4.A3.short.by_lang.vi.rerecorded  | 0.000 · (n=3)       | 0.000 · (n=3)       | 0.000 · (n=3)       | report                                  | rerecorded  |
| v4.A3.short.by_lang.vi.vietmed     | 0.667 · (n=3)       | 0.667 · (n=3)       | 0.667 · (n=3)       | report                                  | vietmed     |
| v4.A3.short.by_lang.vi.vietmed-cut | 0.573 · (n=150)     | 0.573 · (n=150)     | 0.573 · (n=150)     | report                                  | vietmed-cut |
| v4.A3.short.by_lang.vi.vimedcss    | 0.333 · (n=3)       | 0.333 · (n=3)       | 0.333 · (n=3)       | report                                  | vimedcss    |
| v4.A3.short.by_lang.zh             | 0.203 · (n=765)     | 0.203 · (n=765)     | 0.203 · (n=765)     | report                                  | real        |
| v4.A3.short.by_lang.zh.ascend      | 0.209 · (n=738)     | 0.209 · (n=738)     | 0.209 · (n=738)     | report                                  | ascend      |
| v4.A3.short.by_lang.zh.rerecorded  | 0.037 · (n=27)      | 0.037 · (n=27)      | 0.037 · (n=27)      | report                                  | rerecorded  |
| v4.A3.short.vien                   | 0.575 · (n=1505)    | 0.575 · (n=1505)    | 0.575 · (n=1505)    | report                                  | real        |
| v4.A3.short.zh                     | 0.203 · (n=765)     | 0.203 · (n=765)     | 0.203 · (n=765)     | report                                  | real        |
| v4.A4                              | 0.978 · (n=1833)    | 0.978 · (n=1833)    | 0.978 · (n=1833)    | report                                  | real        |
| v4.A5                              | 0.906 · (n=160)     | 0.906 · (n=160)     | 0.906 · (n=160)     | report                                  | esc50+real  |
| v4.A5.esc50                        | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| v4.A5.real                         | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| v4.A6.en-vi.changed                | 0.086 · (n=6758)    | 0.087 · (n=6758)    | 0.087 · (n=6758)    | report                                  | real        |
| v4.A6.en-vi.first_language_p95_ms  | 3107.569 · (n=7662) | 3107.535 · (n=7662) | 3107.535 · (n=7662) | report                                  | real        |
| v4.A6.en-zh.changed                | 0.048 · (n=6428)    | 0.048 · (n=6428)    | 0.048 · (n=6428)    | report                                  | mixed       |
| v4.A6.en-zh.first_language_p95_ms  | 3100.520 · (n=7648) | 3100.450 · (n=7648) | 3100.450 · (n=7648) | report                                  | mixed       |
| v4.A6.vi-zh.changed                | 0.048 · (n=3952)    | 0.048 · (n=3952)    | 0.048 · (n=3952)    | report                                  | mixed       |
| v4.A6.vi-zh.first_language_p95_ms  | 3100.580 · (n=4016) | 3100.580 · (n=4016) | 3100.580 · (n=4016) | report                                  | mixed       |
| v4.A7                              | 125.710 · (n=29672) | 125.710 · (n=29672) | 125.710 · (n=29672) | report                                  | mixed       |
| v4.A9-mono.en                      | 0.120 · (n=200)     | 0.120 · (n=200)     | 0.120 · (n=200)     | report                                  | real        |
| v4.A9-mono.vi                      | 0.000 · (n=200)     | 0.000 · (n=200)     | 0.000 · (n=200)     | report                                  | real        |
| v4.detect2v3.short.en              | -0.316 · (n=1346)   | -0.316 · (n=1346)   | -0.316 · (n=1346)   | report                                  | real        |
| v4.detect2v3.short.vi              | -0.182 · (n=159)    | -0.182 · (n=159)    | -0.182 · (n=159)    | report                                  | real        |
| v4.lock.en-vi.accuracy             | 0.870 · (n=5033)    | 0.870 · (n=5035)    | 0.870 · (n=5035)    | report                                  | real        |
| v4.lock.en-zh.accuracy             | 0.898 · (n=3610)    | 0.897 · (n=3606)    | 0.897 · (n=3606)    | report                                  | mixed       |
| v4.lock.vi-zh.accuracy             | 0.942 · (n=3310)    | 0.942 · (n=3310)    | 0.942 · (n=3310)    | report                                  | mixed       |
| v4.zh_real.A1.en-zh                | 0.841 · (n=1270)    | 0.841 · (n=1270)    | 0.841 · (n=1270)    | report                                  | real        |
| v4.zh_real.A1.vi-zh                | 0.947 · (n=150)     | 0.947 · (n=150)     | 0.947 · (n=150)     | report                                  | real        |
| v4.zh_real.A3                      | 0.487 · (n=1400)    | 0.487 · (n=1400)    | 0.487 · (n=1400)    | report                                  | real        |
| zh_real.A1.en-zh                   | 0.841 · (n=1270)    | 0.841 · (n=1270)    | 0.841 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh                   | 0.947 · (n=150)     | 0.947 · (n=150)     | 0.947 · (n=150)     | report                                  | real        |
| zh_real.A3                         | 0.487 · (n=1400)    | 0.487 · (n=1400)    | 0.487 · (n=1400)    | report                                  | real        |

## whisper_probs_base_ctx5 (cv None, tau_noise 0.0)

| criterion                          | bare                | src                 | src+voice           | threshold                               | data        |
| ---------------------------------- | ------------------- | ------------------- | ------------------- | --------------------------------------- | ----------- |
| A-ACC.detect                       | 0.967 ✓ (n=604)     | 0.964 ✓ (n=604)     | 0.980 ✓ (n=604)     | >=0.95                                  | public      |
| A-ACC.pair                         | 0.976 ✓ (n=616)     | 0.976 ✓ (n=616)     | 0.984 ✓ (n=616)     | >=0.95                                  | public      |
| A1.en-vi                           | 0.986 ✓ (n=5586)    | 0.986 ✓ (n=5586)    | 0.987 ✓ (n=5586)    | >=0.97                                  | real        |
| A1.en-zh                           | 0.989 ✓ (n=4332)    | 0.989 ✓ (n=4332)    | 0.987 ✓ (n=4332)    | >=0.97                                  | mixed       |
| A1.vi-zh                           | 0.987 ✓ (n=3468)    | 0.987 ✓ (n=3468)    | 0.987 ✓ (n=3468)    | >=0.97                                  | mixed       |
| A2.en-vi                           | 0.931 ✓ (n=1227)    | 0.931 ✓ (n=1227)    | 0.931 ✓ (n=1227)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-vi.edacc                     | 0.990 · (n=911)     | 0.987 · (n=911)     | 0.984 · (n=911)     | report                                  | edacc       |
| A2.en-vi.err_after_fallback        | 0.069 ✗ (n=1227)    | 0.073 ✗ (n=1227)    | 0.076 ✗ (n=1227)    | <=0.05                                  | real+cv     |
| A2.en-vi.rerecorded                | 0.833 · (n=24)      | 0.875 · (n=24)      | 0.875 · (n=24)      | report                                  | rerecorded  |
| A2.en-vi.vietmed                   | 1.000 · (n=6)       | 0.833 · (n=6)       | 0.833 · (n=6)       | report                                  | vietmed     |
| A2.en-vi.vietmed-cut               | 0.745 · (n=282)     | 0.738 · (n=282)     | 0.738 · (n=282)     | report                                  | vietmed-cut |
| A2.en-vi.vimedcss                  | 1.000 · (n=4)       | 1.000 · (n=4)       | 1.000 · (n=4)       | report                                  | vimedcss    |
| A2.en-zh                           | 0.862 ✗ (n=2094)    | 0.862 ✗ (n=2094)    | 0.862 ✗ (n=2094)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-zh.ascend                    | 0.833 · (n=1374)    | 0.833 · (n=1374)    | 0.833 · (n=1374)    | report                                  | ascend      |
| A2.en-zh.edacc                     | 0.926 · (n=676)     | 0.926 · (n=676)     | 0.901 · (n=676)     | report                                  | edacc       |
| A2.en-zh.err_after_fallback        | 0.138 ✗ (n=2094)    | 0.137 ✗ (n=2094)    | 0.145 ✗ (n=2094)    | <=0.05                                  | real+cv     |
| A2.en-zh.rerecorded                | 0.818 · (n=44)      | 0.864 · (n=44)      | 0.864 · (n=44)      | report                                  | rerecorded  |
| A2.vi-zh                           | 0.818 ✗ (n=440)     | 0.818 ✗ (n=440)     | 0.818 ✗ (n=440)     | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.vi-zh.ascend                    | 0.983 · (n=116)     | 0.983 · (n=116)     | 0.983 · (n=116)     | report                                  | ascend      |
| A2.vi-zh.err_after_fallback        | 0.182 ✗ (n=440)     | 0.189 ✗ (n=440)     | 0.189 ✗ (n=440)     | <=0.05                                  | real+cv     |
| A2.vi-zh.rerecorded                | 0.875 · (n=32)      | 0.844 · (n=32)      | 0.844 · (n=32)      | report                                  | rerecorded  |
| A2.vi-zh.vietmed                   | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| A2.vi-zh.vietmed-cut               | 0.738 · (n=282)     | 0.730 · (n=282)     | 0.730 · (n=282)     | report                                  | vietmed-cut |
| A2.vi-zh.vimedcss                  | 1.000 · (n=4)       | 1.000 · (n=4)       | 1.000 · (n=4)       | report                                  | vimedcss    |
| A3.long.by_lang.en                 | 0.979 · (n=1623)    | 0.978 · (n=1623)    | 0.984 · (n=1623)    | report                                  | real        |
| A3.long.by_lang.vi                 | 0.983 · (n=2305)    | 0.982 · (n=2305)    | 0.984 · (n=2305)    | report                                  | real        |
| A3.long.by_lang.zh                 | 0.986 · (n=635)     | 0.986 · (n=635)     | 0.986 · (n=635)     | report                                  | real        |
| A3.long.vien                       | 0.981 ✓ (n=3928)    | 0.980 ✓ (n=3928)    | 0.984 ✓ (n=3928)    | >=0.95                                  | real        |
| A3.long.zh                         | 0.992 ✓ (n=1135)    | 0.992 ✓ (n=1135)    | 0.992 ✓ (n=1135)    | >=0.95                                  | mixed       |
| A3.short.by_lang.en                | 0.911 · (n=790)     | 0.913 · (n=790)     | 0.919 · (n=790)     | report                                  | real        |
| A3.short.by_lang.en.ascend         | 0.880 · (n=208)     | 0.880 · (n=208)     | 0.880 · (n=208)     | report                                  | ascend      |
| A3.short.by_lang.en.edacc          | 0.923 · (n=573)     | 0.925 · (n=573)     | 0.934 · (n=573)     | report                                  | edacc       |
| A3.short.by_lang.en.rerecorded     | 0.889 · (n=9)       | 0.889 · (n=9)       | 0.889 · (n=9)       | report                                  | rerecorded  |
| A3.short.by_lang.vi                | 0.617 · (n=149)     | 0.617 · (n=149)     | 0.617 · (n=149)     | report                                  | real        |
| A3.short.by_lang.vi.rerecorded     | 0.000 · (n=3)       | 0.000 · (n=3)       | 0.000 · (n=3)       | report                                  | rerecorded  |
| A3.short.by_lang.vi.vietmed        | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | vietmed     |
| A3.short.by_lang.vi.vietmed-cut    | 0.617 · (n=141)     | 0.617 · (n=141)     | 0.617 · (n=141)     | report                                  | vietmed-cut |
| A3.short.by_lang.vi.vimedcss       | 1.000 · (n=2)       | 1.000 · (n=2)       | 1.000 · (n=2)       | report                                  | vimedcss    |
| A3.short.by_lang.zh                | 0.791 · (n=492)     | 0.791 · (n=492)     | 0.791 · (n=492)     | report                                  | real        |
| A3.short.by_lang.zh.ascend         | 0.791 · (n=479)     | 0.791 · (n=479)     | 0.791 · (n=479)     | report                                  | ascend      |
| A3.short.by_lang.zh.rerecorded     | 0.769 · (n=13)      | 0.769 · (n=13)      | 0.769 · (n=13)      | report                                  | rerecorded  |
| A3.short.vien                      | 0.865 ✓ (n=939)     | 0.866 ✓ (n=939)     | 0.871 ✓ (n=939)     | >=0.85                                  | real        |
| A3.short.zh                        | 0.791 ✗ (n=492)     | 0.791 ✗ (n=492)     | 0.791 ✗ (n=492)     | >=0.85                                  | real        |
| A4                                 | 0.963 ✓ (n=1833)    | 0.963 ✓ (n=1833)    | 0.963 ✓ (n=1833)    | >=0.95                                  | real        |
| A5                                 | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | >=0.90 rejected                         | esc50+real  |
| A5.esc50                           | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| A5.real                            | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| A6.en-vi.changed                   | 0.075 ✓ (n=6618)    | 0.074 ✓ (n=6618)    | 0.074 ✓ (n=6618)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms     | 3099.130 ✓ (n=6813) | 3099.130 ✓ (n=6813) | 3099.130 ✓ (n=6813) | <=3500                                  | real        |
| A6.en-zh.changed                   | 0.010 ✓ (n=6156)    | 0.010 ✓ (n=6156)    | 0.010 ✓ (n=6156)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms     | 3094.475 ✓ (n=6426) | 3094.475 ✓ (n=6426) | 3095.438 ✓ (n=6426) | <=3500                                  | mixed       |
| A6.vi-zh.changed                   | 0.085 ✓ (n=3894)    | 0.084 ✓ (n=3894)    | 0.084 ✓ (n=3894)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms     | 3086.382 ✓ (n=3908) | 3086.382 ✓ (n=3908) | 3086.382 ✓ (n=3908) | <=3500                                  | mixed       |
| A7                                 | 125.710 ✓ (n=29672) | 125.710 ✓ (n=29672) | 125.710 ✓ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                         | 0.014 ✓ (n=138)     | 0.014 ✓ (n=138)     | 0.000 ✓ (n=138)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                         | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| detect2v3.short.en                 | -0.076 ✗ (n=790)    | -0.075 ✗ (n=790)    | -0.071 ✗ (n=790)    | >=-0.02                                 | real        |
| detect2v3.short.vi                 | -0.128 ✗ (n=149)    | -0.128 ✗ (n=149)    | -0.128 ✗ (n=149)    | >=-0.02                                 | real        |
| excluded.en                        | 0.188 · (n=2970)    | 0.188 · (n=2970)    | 0.188 · (n=2970)    | report                                  | real        |
| excluded.vi                        | 0.009 · (n=2476)    | 0.009 · (n=2476)    | 0.009 · (n=2476)    | report                                  | real        |
| excluded.zh                        | 0.195 · (n=1400)    | 0.195 · (n=1400)    | 0.195 · (n=1400)    | report                                  | real        |
| lock.en-vi.accuracy                | 0.900 · (n=5297)    | 0.900 · (n=5297)    | 0.900 · (n=5297)    | report                                  | real        |
| lock.en-zh.accuracy                | 0.981 · (n=4052)    | 0.981 · (n=4052)    | 0.982 · (n=4040)    | report                                  | mixed       |
| lock.vi-zh.accuracy                | 0.897 · (n=3440)    | 0.897 · (n=3440)    | 0.897 · (n=3440)    | report                                  | mixed       |
| v4.A-ACC.detect                    | 0.967 · (n=604)     | 0.964 · (n=604)     | 0.980 · (n=604)     | report                                  | public      |
| v4.A-ACC.pair                      | 0.976 · (n=616)     | 0.976 · (n=616)     | 0.984 · (n=616)     | report                                  | public      |
| v4.A1.en-vi                        | 0.985 · (n=5612)    | 0.985 · (n=5612)    | 0.986 · (n=5612)    | report                                  | real        |
| v4.A1.en-zh                        | 0.989 · (n=4334)    | 0.989 · (n=4334)    | 0.987 · (n=4334)    | report                                  | mixed       |
| v4.A1.vi-zh                        | 0.986 · (n=3492)    | 0.986 · (n=3492)    | 0.986 · (n=3492)    | report                                  | mixed       |
| v4.A2.en-vi                        | 0.952 · (n=2050)    | 0.952 · (n=2050)    | 0.952 · (n=2050)    | report                                  | real+cv     |
| v4.A2.en-vi.edacc                  | 0.995 · (n=1682)    | 0.993 · (n=1682)    | 0.989 · (n=1682)    | report                                  | edacc       |
| v4.A2.en-vi.err_after_fallback     | 0.048 · (n=2050)    | 0.051 · (n=2050)    | 0.054 · (n=2050)    | report                                  | real+cv     |
| v4.A2.en-vi.rerecorded             | 0.929 · (n=56)      | 0.946 · (n=56)      | 0.946 · (n=56)      | report                                  | rerecorded  |
| v4.A2.en-vi.vietmed                | 1.000 · (n=6)       | 0.833 · (n=6)       | 0.833 · (n=6)       | report                                  | vietmed     |
| v4.A2.en-vi.vietmed-cut            | 0.720 · (n=300)     | 0.710 · (n=300)     | 0.710 · (n=300)     | report                                  | vietmed-cut |
| v4.A2.en-vi.vimedcss               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| v4.A2.en-zh                        | 0.769 · (n=3314)    | 0.769 · (n=3314)    | 0.769 · (n=3314)    | report                                  | real+cv     |
| v4.A2.en-zh.ascend                 | 0.663 · (n=1982)    | 0.663 · (n=1982)    | 0.663 · (n=1982)    | report                                  | ascend      |
| v4.A2.en-zh.edacc                  | 0.943 · (n=1228)    | 0.940 · (n=1228)    | 0.900 · (n=1228)    | report                                  | edacc       |
| v4.A2.en-zh.err_after_fallback     | 0.231 · (n=3314)    | 0.231 · (n=3314)    | 0.246 · (n=3314)    | report                                  | real+cv     |
| v4.A2.en-zh.rerecorded             | 0.750 · (n=104)     | 0.760 · (n=104)     | 0.760 · (n=104)     | report                                  | rerecorded  |
| v4.A2.vi-zh                        | 0.813 · (n=524)     | 0.813 · (n=524)     | 0.813 · (n=524)     | report                                  | real+cv     |
| v4.A2.vi-zh.ascend                 | 0.987 · (n=152)     | 0.987 · (n=152)     | 0.987 · (n=152)     | report                                  | ascend      |
| v4.A2.vi-zh.err_after_fallback     | 0.187 · (n=524)     | 0.187 · (n=524)     | 0.187 · (n=524)     | report                                  | real+cv     |
| v4.A2.vi-zh.rerecorded             | 0.933 · (n=60)      | 0.917 · (n=60)      | 0.917 · (n=60)      | report                                  | rerecorded  |
| v4.A2.vi-zh.vietmed                | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| v4.A2.vi-zh.vietmed-cut            | 0.700 · (n=300)     | 0.703 · (n=300)     | 0.703 · (n=300)     | report                                  | vietmed-cut |
| v4.A2.vi-zh.vimedcss               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| v4.A3.long.by_lang.en              | 0.979 · (n=1624)    | 0.978 · (n=1624)    | 0.984 · (n=1624)    | report                                  | real        |
| v4.A3.long.by_lang.vi              | 0.981 · (n=2317)    | 0.981 · (n=2317)    | 0.982 · (n=2317)    | report                                  | real        |
| v4.A3.long.by_lang.zh              | 0.986 · (n=635)     | 0.986 · (n=635)     | 0.986 · (n=635)     | report                                  | real        |
| v4.A3.long.vien                    | 0.980 · (n=3941)    | 0.979 · (n=3941)    | 0.983 · (n=3941)    | report                                  | real        |
| v4.A3.long.zh                      | 0.992 · (n=1135)    | 0.992 · (n=1135)    | 0.992 · (n=1135)    | report                                  | mixed       |
| v4.A3.short.by_lang.en             | 0.929 · (n=1346)    | 0.928 · (n=1346)    | 0.933 · (n=1346)    | report                                  | real        |
| v4.A3.short.by_lang.en.ascend      | 0.885 · (n=253)     | 0.885 · (n=253)     | 0.885 · (n=253)     | report                                  | ascend      |
| v4.A3.short.by_lang.en.edacc       | 0.938 · (n=1068)    | 0.937 · (n=1068)    | 0.944 · (n=1068)    | report                                  | edacc       |
| v4.A3.short.by_lang.en.rerecorded  | 0.960 · (n=25)      | 0.960 · (n=25)      | 0.960 · (n=25)      | report                                  | rerecorded  |
| v4.A3.short.by_lang.vi             | 0.585 · (n=159)     | 0.585 · (n=159)     | 0.585 · (n=159)     | report                                  | real        |
| v4.A3.short.by_lang.vi.rerecorded  | 0.000 · (n=3)       | 0.000 · (n=3)       | 0.000 · (n=3)       | report                                  | rerecorded  |
| v4.A3.short.by_lang.vi.vietmed     | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | vietmed     |
| v4.A3.short.by_lang.vi.vietmed-cut | 0.587 · (n=150)     | 0.587 · (n=150)     | 0.587 · (n=150)     | report                                  | vietmed-cut |
| v4.A3.short.by_lang.vi.vimedcss    | 0.667 · (n=3)       | 0.667 · (n=3)       | 0.667 · (n=3)       | report                                  | vimedcss    |
| v4.A3.short.by_lang.zh             | 0.569 · (n=765)     | 0.569 · (n=765)     | 0.569 · (n=765)     | report                                  | real        |
| v4.A3.short.by_lang.zh.ascend      | 0.569 · (n=738)     | 0.569 · (n=738)     | 0.569 · (n=738)     | report                                  | ascend      |
| v4.A3.short.by_lang.zh.rerecorded  | 0.556 · (n=27)      | 0.556 · (n=27)      | 0.556 · (n=27)      | report                                  | rerecorded  |
| v4.A3.short.vien                   | 0.892 · (n=1505)    | 0.892 · (n=1505)    | 0.896 · (n=1505)    | report                                  | real        |
| v4.A3.short.zh                     | 0.569 · (n=765)     | 0.569 · (n=765)     | 0.569 · (n=765)     | report                                  | real        |
| v4.A4                              | 0.963 · (n=1833)    | 0.963 · (n=1833)    | 0.963 · (n=1833)    | report                                  | real        |
| v4.A5                              | 0.906 · (n=160)     | 0.906 · (n=160)     | 0.906 · (n=160)     | report                                  | esc50+real  |
| v4.A5.esc50                        | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| v4.A5.real                         | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| v4.A6.en-vi.changed                | 0.074 · (n=6758)    | 0.073 · (n=6758)    | 0.074 · (n=6758)    | report                                  | real        |
| v4.A6.en-vi.first_language_p95_ms  | 3096.780 · (n=7662) | 3096.780 · (n=7662) | 3096.780 · (n=7662) | report                                  | real        |
| v4.A6.en-zh.changed                | 0.010 · (n=6428)    | 0.010 · (n=6428)    | 0.009 · (n=6428)    | report                                  | mixed       |
| v4.A6.en-zh.first_language_p95_ms  | 3090.150 · (n=7648) | 3090.150 · (n=7648) | 3090.590 · (n=7648) | report                                  | mixed       |
| v4.A6.vi-zh.changed                | 0.086 · (n=3952)    | 0.085 · (n=3952)    | 0.085 · (n=3952)    | report                                  | mixed       |
| v4.A6.vi-zh.first_language_p95_ms  | 3086.320 · (n=4016) | 3086.320 · (n=4016) | 3086.320 · (n=4016) | report                                  | mixed       |
| v4.A7                              | 125.710 · (n=29672) | 125.710 · (n=29672) | 125.710 · (n=29672) | report                                  | mixed       |
| v4.A9-mono.en                      | 0.010 · (n=200)     | 0.010 · (n=200)     | 0.000 · (n=200)     | report                                  | real        |
| v4.A9-mono.vi                      | 0.000 · (n=200)     | 0.000 · (n=200)     | 0.000 · (n=200)     | report                                  | real        |
| v4.detect2v3.short.en              | -0.062 · (n=1346)   | -0.063 · (n=1346)   | -0.059 · (n=1346)   | report                                  | real        |
| v4.detect2v3.short.vi              | -0.132 · (n=159)    | -0.132 · (n=159)    | -0.132 · (n=159)    | report                                  | real        |
| v4.lock.en-vi.accuracy             | 0.897 · (n=5321)    | 0.897 · (n=5321)    | 0.897 · (n=5321)    | report                                  | real        |
| v4.lock.en-zh.accuracy             | 0.981 · (n=4052)    | 0.981 · (n=4052)    | 0.982 · (n=4040)    | report                                  | mixed       |
| v4.lock.vi-zh.accuracy             | 0.895 · (n=3464)    | 0.895 · (n=3464)    | 0.895 · (n=3464)    | report                                  | mixed       |
| v4.zh_real.A1.en-zh                | 0.986 · (n=1270)    | 0.986 · (n=1270)    | 0.986 · (n=1270)    | report                                  | real        |
| v4.zh_real.A1.vi-zh                | 1.000 · (n=150)     | 1.000 · (n=150)     | 1.000 · (n=150)     | report                                  | real        |
| v4.zh_real.A3                      | 0.758 · (n=1400)    | 0.758 · (n=1400)    | 0.758 · (n=1400)    | report                                  | real        |
| zh_real.A1.en-zh                   | 0.986 · (n=1270)    | 0.986 · (n=1270)    | 0.986 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh                   | 1.000 · (n=150)     | 1.000 · (n=150)     | 1.000 · (n=150)     | report                                  | real        |
| zh_real.A3                         | 0.758 · (n=1400)    | 0.758 · (n=1400)    | 0.758 · (n=1400)    | report                                  | real        |
