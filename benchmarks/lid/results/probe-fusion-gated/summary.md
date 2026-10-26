# LID bake-off `probe-fusion-gated` (ruler v5)

Outcome: **INCOMPLETE**

## fusion_gated_1500 (cv None, tau_noise 0.0)

| criterion                          | bare                | src                 | src+voice           | threshold                               | data        |
| ---------------------------------- | ------------------- | ------------------- | ------------------- | --------------------------------------- | ----------- |
| A-ACC.detect                       | 0.967 ✓ (n=604)     | 0.965 ✓ (n=604)     | 0.980 ✓ (n=604)     | >=0.95                                  | public      |
| A-ACC.pair                         | 0.976 ✓ (n=616)     | 0.974 ✓ (n=616)     | 0.984 ✓ (n=616)     | >=0.95                                  | public      |
| A1.en-vi                           | 0.986 ✓ (n=5586)    | 0.986 ✓ (n=5586)    | 0.987 ✓ (n=5586)    | >=0.97                                  | real        |
| A1.en-zh                           | 0.989 ✓ (n=4332)    | 0.989 ✓ (n=4332)    | 0.989 ✓ (n=4332)    | >=0.97                                  | mixed       |
| A1.vi-zh                           | 0.987 ✓ (n=3468)    | 0.987 ✓ (n=3468)    | 0.987 ✓ (n=3468)    | >=0.97                                  | mixed       |
| A2.en-vi                           | 0.958 ✓ (n=1227)    | 0.958 ✓ (n=1227)    | 0.958 ✓ (n=1227)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-vi.edacc                     | 0.954 · (n=911)     | 0.950 · (n=911)     | 0.952 · (n=911)     | report                                  | edacc       |
| A2.en-vi.err_after_fallback        | 0.042 ✓ (n=1227)    | 0.046 ✓ (n=1227)    | 0.045 ✓ (n=1227)    | <=0.05                                  | real+cv     |
| A2.en-vi.rerecorded                | 1.000 · (n=24)      | 1.000 · (n=24)      | 1.000 · (n=24)      | report                                  | rerecorded  |
| A2.en-vi.vietmed                   | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| A2.en-vi.vietmed-cut               | 0.965 · (n=282)     | 0.961 · (n=282)     | 0.961 · (n=282)     | report                                  | vietmed-cut |
| A2.en-vi.vimedcss                  | 1.000 · (n=4)       | 1.000 · (n=4)       | 1.000 · (n=4)       | report                                  | vimedcss    |
| A2.en-zh                           | 0.892 ✗ (n=2094)    | 0.892 ✗ (n=2094)    | 0.892 ✗ (n=2094)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-zh.ascend                    | 0.875 · (n=1374)    | 0.875 · (n=1374)    | 0.887 · (n=1374)    | report                                  | ascend      |
| A2.en-zh.edacc                     | 0.926 · (n=676)     | 0.925 · (n=676)     | 0.925 · (n=676)     | report                                  | edacc       |
| A2.en-zh.err_after_fallback        | 0.108 ✗ (n=2094)    | 0.108 ✗ (n=2094)    | 0.100 ✗ (n=2094)    | <=0.05                                  | real+cv     |
| A2.en-zh.rerecorded                | 0.909 · (n=44)      | 0.909 · (n=44)      | 0.909 · (n=44)      | report                                  | rerecorded  |
| A2.vi-zh                           | 0.950 ✓ (n=440)     | 0.950 ✓ (n=440)     | 0.950 ✓ (n=440)     | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.vi-zh.ascend                    | 0.948 · (n=116)     | 0.948 · (n=116)     | 0.948 · (n=116)     | report                                  | ascend      |
| A2.vi-zh.err_after_fallback        | 0.050 ✗ (n=440)     | 0.048 ✓ (n=440)     | 0.048 ✓ (n=440)     | <=0.05                                  | real+cv     |
| A2.vi-zh.rerecorded                | 1.000 · (n=32)      | 1.000 · (n=32)      | 1.000 · (n=32)      | report                                  | rerecorded  |
| A2.vi-zh.vietmed                   | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| A2.vi-zh.vietmed-cut               | 0.943 · (n=282)     | 0.947 · (n=282)     | 0.947 · (n=282)     | report                                  | vietmed-cut |
| A2.vi-zh.vimedcss                  | 1.000 · (n=4)       | 1.000 · (n=4)       | 1.000 · (n=4)       | report                                  | vimedcss    |
| A3.long.by_lang.en                 | 0.979 · (n=1623)    | 0.978 · (n=1623)    | 0.982 · (n=1623)    | report                                  | real        |
| A3.long.by_lang.vi                 | 0.983 · (n=2305)    | 0.982 · (n=2305)    | 0.984 · (n=2305)    | report                                  | real        |
| A3.long.by_lang.zh                 | 0.986 · (n=635)     | 0.986 · (n=635)     | 0.987 · (n=635)     | report                                  | real        |
| A3.long.vien                       | 0.981 ✓ (n=3928)    | 0.981 ✓ (n=3928)    | 0.983 ✓ (n=3928)    | >=0.95                                  | real        |
| A3.long.zh                         | 0.992 ✓ (n=1135)    | 0.992 ✓ (n=1135)    | 0.993 ✓ (n=1135)    | >=0.95                                  | mixed       |
| A3.short.by_lang.en                | 0.877 · (n=790)     | 0.870 · (n=790)     | 0.881 · (n=790)     | report                                  | real        |
| A3.short.by_lang.en.ascend         | 0.870 · (n=208)     | 0.870 · (n=208)     | 0.885 · (n=208)     | report                                  | ascend      |
| A3.short.by_lang.en.edacc          | 0.880 · (n=573)     | 0.869 · (n=573)     | 0.880 · (n=573)     | report                                  | edacc       |
| A3.short.by_lang.en.rerecorded     | 0.889 · (n=9)       | 0.889 · (n=9)       | 0.889 · (n=9)       | report                                  | rerecorded  |
| A3.short.by_lang.vi                | 0.933 · (n=149)     | 0.933 · (n=149)     | 0.933 · (n=149)     | report                                  | real        |
| A3.short.by_lang.vi.rerecorded     | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | rerecorded  |
| A3.short.by_lang.vi.vietmed        | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | vietmed     |
| A3.short.by_lang.vi.vietmed-cut    | 0.929 · (n=141)     | 0.929 · (n=141)     | 0.929 · (n=141)     | report                                  | vietmed-cut |
| A3.short.by_lang.vi.vimedcss       | 1.000 · (n=2)       | 1.000 · (n=2)       | 1.000 · (n=2)       | report                                  | vimedcss    |
| A3.short.by_lang.zh                | 0.850 · (n=492)     | 0.850 · (n=492)     | 0.866 · (n=492)     | report                                  | real        |
| A3.short.by_lang.zh.ascend         | 0.848 · (n=479)     | 0.848 · (n=479)     | 0.864 · (n=479)     | report                                  | ascend      |
| A3.short.by_lang.zh.rerecorded     | 0.923 · (n=13)      | 0.923 · (n=13)      | 0.923 · (n=13)      | report                                  | rerecorded  |
| A3.short.vien                      | 0.886 ✓ (n=939)     | 0.880 ✓ (n=939)     | 0.889 ✓ (n=939)     | >=0.85                                  | real        |
| A3.short.zh                        | 0.850 ✗ (n=492)     | 0.850 ✗ (n=492)     | 0.866 ✓ (n=492)     | >=0.85                                  | real        |
| A4                                 | 0.963 ✓ (n=1833)    | 0.963 ✓ (n=1833)    | 0.963 ✓ (n=1833)    | >=0.95                                  | real        |
| A5                                 | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | >=0.90 rejected                         | esc50+real  |
| A5.esc50                           | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| A5.real                            | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| A6.en-vi.changed                   | 0.063 ✓ (n=6618)    | 0.062 ✓ (n=6618)    | 0.062 ✓ (n=6618)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms     | 2124.886 ✓ (n=6813) | 2124.886 ✓ (n=6813) | 2124.886 ✓ (n=6813) | <=3500                                  | real        |
| A6.en-zh.changed                   | 0.038 ✓ (n=6156)    | 0.038 ✓ (n=6156)    | 0.038 ✓ (n=6156)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms     | 2123.800 ✓ (n=6426) | 2123.800 ✓ (n=6426) | 2123.800 ✓ (n=6426) | <=3500                                  | mixed       |
| A6.vi-zh.changed                   | 0.051 ✓ (n=3894)    | 0.051 ✓ (n=3894)    | 0.051 ✓ (n=3894)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms     | 1640.628 ✓ (n=3908) | 1640.628 ✓ (n=3908) | 1640.628 ✓ (n=3908) | <=3500                                  | mixed       |
| A7                                 | 129.290 ✓ (n=29672) | 129.290 ✓ (n=29672) | 129.290 ✓ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                         | 0.029 ✓ (n=138)     | 0.029 ✓ (n=138)     | 0.029 ✓ (n=138)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                         | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| detect2v3.short.en                 | -0.110 ✗ (n=790)    | -0.118 ✗ (n=790)    | -0.109 ✗ (n=790)    | >=-0.02                                 | real        |
| detect2v3.short.vi                 | 0.188 ✓ (n=149)     | 0.188 ✓ (n=149)     | 0.188 ✓ (n=149)     | >=-0.02                                 | real        |
| excluded.en                        | 0.188 · (n=2970)    | 0.188 · (n=2970)    | 0.188 · (n=2970)    | report                                  | real        |
| excluded.vi                        | 0.009 · (n=2476)    | 0.009 · (n=2476)    | 0.009 · (n=2476)    | report                                  | real        |
| excluded.zh                        | 0.195 · (n=1400)    | 0.195 · (n=1400)    | 0.195 · (n=1400)    | report                                  | real        |
| lock.en-vi.accuracy                | 0.930 · (n=6038)    | 0.930 · (n=6038)    | 0.930 · (n=6038)    | report                                  | real        |
| lock.en-zh.accuracy                | 0.953 · (n=5242)    | 0.953 · (n=5242)    | 0.953 · (n=5242)    | report                                  | mixed       |
| lock.vi-zh.accuracy                | 0.948 · (n=3764)    | 0.948 · (n=3764)    | 0.948 · (n=3764)    | report                                  | mixed       |
| v4.A-ACC.detect                    | 0.967 · (n=604)     | 0.965 · (n=604)     | 0.980 · (n=604)     | report                                  | public      |
| v4.A-ACC.pair                      | 0.976 · (n=616)     | 0.974 · (n=616)     | 0.984 · (n=616)     | report                                  | public      |
| v4.A1.en-vi                        | 0.985 · (n=5612)    | 0.985 · (n=5612)    | 0.986 · (n=5612)    | report                                  | real        |
| v4.A1.en-zh                        | 0.989 · (n=4334)    | 0.989 · (n=4334)    | 0.989 · (n=4334)    | report                                  | mixed       |
| v4.A1.vi-zh                        | 0.986 · (n=3492)    | 0.986 · (n=3492)    | 0.986 · (n=3492)    | report                                  | mixed       |
| v4.A2.en-vi                        | 0.944 · (n=2050)    | 0.944 · (n=2050)    | 0.944 · (n=2050)    | report                                  | real+cv     |
| v4.A2.en-vi.edacc                  | 0.944 · (n=1682)    | 0.943 · (n=1682)    | 0.945 · (n=1682)    | report                                  | edacc       |
| v4.A2.en-vi.err_after_fallback     | 0.056 · (n=2050)    | 0.058 · (n=2050)    | 0.056 · (n=2050)    | report                                  | real+cv     |
| v4.A2.en-vi.rerecorded             | 1.000 · (n=56)      | 0.982 · (n=56)      | 0.982 · (n=56)      | report                                  | rerecorded  |
| v4.A2.en-vi.vietmed                | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| v4.A2.en-vi.vietmed-cut            | 0.940 · (n=300)     | 0.937 · (n=300)     | 0.937 · (n=300)     | report                                  | vietmed-cut |
| v4.A2.en-vi.vimedcss               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| v4.A2.en-zh                        | 0.797 · (n=3314)    | 0.797 · (n=3314)    | 0.797 · (n=3314)    | report                                  | real+cv     |
| v4.A2.en-zh.ascend                 | 0.733 · (n=1982)    | 0.733 · (n=1982)    | 0.744 · (n=1982)    | report                                  | ascend      |
| v4.A2.en-zh.edacc                  | 0.899 · (n=1228)    | 0.897 · (n=1228)    | 0.897 · (n=1228)    | report                                  | edacc       |
| v4.A2.en-zh.err_after_fallback     | 0.203 · (n=3314)    | 0.204 · (n=3314)    | 0.198 · (n=3314)    | report                                  | real+cv     |
| v4.A2.en-zh.rerecorded             | 0.808 · (n=104)     | 0.808 · (n=104)     | 0.808 · (n=104)     | report                                  | rerecorded  |
| v4.A2.vi-zh                        | 0.908 · (n=524)     | 0.908 · (n=524)     | 0.908 · (n=524)     | report                                  | real+cv     |
| v4.A2.vi-zh.ascend                 | 0.895 · (n=152)     | 0.895 · (n=152)     | 0.908 · (n=152)     | report                                  | ascend      |
| v4.A2.vi-zh.err_after_fallback     | 0.092 · (n=524)     | 0.090 · (n=524)     | 0.086 · (n=524)     | report                                  | real+cv     |
| v4.A2.vi-zh.rerecorded             | 0.933 · (n=60)      | 0.933 · (n=60)      | 0.933 · (n=60)      | report                                  | rerecorded  |
| v4.A2.vi-zh.vietmed                | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| v4.A2.vi-zh.vietmed-cut            | 0.913 · (n=300)     | 0.917 · (n=300)     | 0.917 · (n=300)     | report                                  | vietmed-cut |
| v4.A2.vi-zh.vimedcss               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| v4.A3.long.by_lang.en              | 0.979 · (n=1624)    | 0.978 · (n=1624)    | 0.982 · (n=1624)    | report                                  | real        |
| v4.A3.long.by_lang.vi              | 0.981 · (n=2317)    | 0.981 · (n=2317)    | 0.982 · (n=2317)    | report                                  | real        |
| v4.A3.long.by_lang.zh              | 0.986 · (n=635)     | 0.986 · (n=635)     | 0.987 · (n=635)     | report                                  | real        |
| v4.A3.long.vien                    | 0.980 · (n=3941)    | 0.980 · (n=3941)    | 0.982 · (n=3941)    | report                                  | real        |
| v4.A3.long.zh                      | 0.992 · (n=1135)    | 0.992 · (n=1135)    | 0.993 · (n=1135)    | report                                  | mixed       |
| v4.A3.short.by_lang.en             | 0.854 · (n=1346)    | 0.851 · (n=1346)    | 0.862 · (n=1346)    | report                                  | real        |
| v4.A3.short.by_lang.en.ascend      | 0.862 · (n=253)     | 0.862 · (n=253)     | 0.881 · (n=253)     | report                                  | ascend      |
| v4.A3.short.by_lang.en.edacc       | 0.849 · (n=1068)    | 0.846 · (n=1068)    | 0.855 · (n=1068)    | report                                  | edacc       |
| v4.A3.short.by_lang.en.rerecorded  | 0.960 · (n=25)      | 0.960 · (n=25)      | 0.960 · (n=25)      | report                                  | rerecorded  |
| v4.A3.short.by_lang.vi             | 0.899 · (n=159)     | 0.899 · (n=159)     | 0.899 · (n=159)     | report                                  | real        |
| v4.A3.short.by_lang.vi.rerecorded  | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | rerecorded  |
| v4.A3.short.by_lang.vi.vietmed     | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | vietmed     |
| v4.A3.short.by_lang.vi.vietmed-cut | 0.900 · (n=150)     | 0.900 · (n=150)     | 0.900 · (n=150)     | report                                  | vietmed-cut |
| v4.A3.short.by_lang.vi.vimedcss    | 0.667 · (n=3)       | 0.667 · (n=3)       | 0.667 · (n=3)       | report                                  | vimedcss    |
| v4.A3.short.by_lang.zh             | 0.638 · (n=765)     | 0.638 · (n=765)     | 0.663 · (n=765)     | report                                  | real        |
| v4.A3.short.by_lang.zh.ascend      | 0.637 · (n=738)     | 0.637 · (n=738)     | 0.663 · (n=738)     | report                                  | ascend      |
| v4.A3.short.by_lang.zh.rerecorded  | 0.667 · (n=27)      | 0.667 · (n=27)      | 0.667 · (n=27)      | report                                  | rerecorded  |
| v4.A3.short.vien                   | 0.858 · (n=1505)    | 0.856 · (n=1505)    | 0.866 · (n=1505)    | report                                  | real        |
| v4.A3.short.zh                     | 0.638 · (n=765)     | 0.638 · (n=765)     | 0.663 · (n=765)     | report                                  | real        |
| v4.A4                              | 0.963 · (n=1833)    | 0.963 · (n=1833)    | 0.963 · (n=1833)    | report                                  | real        |
| v4.A5                              | 0.906 · (n=160)     | 0.906 · (n=160)     | 0.906 · (n=160)     | report                                  | esc50+real  |
| v4.A5.esc50                        | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| v4.A5.real                         | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| v4.A6.en-vi.changed                | 0.063 · (n=6758)    | 0.062 · (n=6758)    | 0.062 · (n=6758)    | report                                  | real        |
| v4.A6.en-vi.first_language_p95_ms  | 2119.410 · (n=7662) | 2119.410 · (n=7662) | 2119.410 · (n=7662) | report                                  | real        |
| v4.A6.en-zh.changed                | 0.036 · (n=6428)    | 0.036 · (n=6428)    | 0.036 · (n=6428)    | report                                  | mixed       |
| v4.A6.en-zh.first_language_p95_ms  | 2105.170 · (n=7648) | 2105.170 · (n=7648) | 2105.170 · (n=7648) | report                                  | mixed       |
| v4.A6.vi-zh.changed                | 0.053 · (n=3952)    | 0.053 · (n=3952)    | 0.053 · (n=3952)    | report                                  | mixed       |
| v4.A6.vi-zh.first_language_p95_ms  | 1634.860 · (n=4016) | 1634.860 · (n=4016) | 1634.860 · (n=4016) | report                                  | mixed       |
| v4.A7                              | 129.290 · (n=29672) | 129.290 · (n=29672) | 129.290 · (n=29672) | report                                  | mixed       |
| v4.A9-mono.en                      | 0.020 · (n=200)     | 0.020 · (n=200)     | 0.020 · (n=200)     | report                                  | real        |
| v4.A9-mono.vi                      | 0.000 · (n=200)     | 0.000 · (n=200)     | 0.000 · (n=200)     | report                                  | real        |
| v4.detect2v3.short.en              | -0.137 · (n=1346)   | -0.140 · (n=1346)   | -0.131 · (n=1346)   | report                                  | real        |
| v4.detect2v3.short.vi              | 0.182 · (n=159)     | 0.182 · (n=159)     | 0.182 · (n=159)     | report                                  | real        |
| v4.lock.en-vi.accuracy             | 0.927 · (n=6082)    | 0.927 · (n=6082)    | 0.927 · (n=6082)    | report                                  | real        |
| v4.lock.en-zh.accuracy             | 0.949 · (n=5276)    | 0.949 · (n=5276)    | 0.949 · (n=5276)    | report                                  | mixed       |
| v4.lock.vi-zh.accuracy             | 0.946 · (n=3798)    | 0.946 · (n=3798)    | 0.946 · (n=3798)    | report                                  | mixed       |
| v4.zh_real.A1.en-zh                | 0.986 · (n=1270)    | 0.986 · (n=1270)    | 0.987 · (n=1270)    | report                                  | real        |
| v4.zh_real.A1.vi-zh                | 1.000 · (n=150)     | 1.000 · (n=150)     | 1.000 · (n=150)     | report                                  | real        |
| v4.zh_real.A3                      | 0.796 · (n=1400)    | 0.796 · (n=1400)    | 0.810 · (n=1400)    | report                                  | real        |
| zh_real.A1.en-zh                   | 0.986 · (n=1270)    | 0.986 · (n=1270)    | 0.987 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh                   | 1.000 · (n=150)     | 1.000 · (n=150)     | 1.000 · (n=150)     | report                                  | real        |
| zh_real.A3                         | 0.796 · (n=1400)    | 0.796 · (n=1400)    | 0.810 · (n=1400)    | report                                  | real        |

## fusion_gated_1500_set (cv None, tau_noise 0.0)

| criterion                          | bare                | src                 | src+voice           | threshold                               | data        |
| ---------------------------------- | ------------------- | ------------------- | ------------------- | --------------------------------------- | ----------- |
| A-ACC.detect                       | 0.967 ✓ (n=604)     | 0.964 ✓ (n=604)     | 0.980 ✓ (n=604)     | >=0.95                                  | public      |
| A-ACC.pair                         | 0.976 ✓ (n=616)     | 0.974 ✓ (n=616)     | 0.984 ✓ (n=616)     | >=0.95                                  | public      |
| A1.en-vi                           | 0.986 ✓ (n=5586)    | 0.986 ✓ (n=5586)    | 0.987 ✓ (n=5586)    | >=0.97                                  | real        |
| A1.en-zh                           | 0.989 ✓ (n=4332)    | 0.989 ✓ (n=4332)    | 0.989 ✓ (n=4332)    | >=0.97                                  | mixed       |
| A1.vi-zh                           | 0.987 ✓ (n=3468)    | 0.987 ✓ (n=3468)    | 0.987 ✓ (n=3468)    | >=0.97                                  | mixed       |
| A2.en-vi                           | 0.970 ✓ (n=1227)    | 0.970 ✓ (n=1227)    | 0.970 ✓ (n=1227)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-vi.edacc                     | 0.979 · (n=911)     | 0.975 · (n=911)     | 0.980 · (n=911)     | report                                  | edacc       |
| A2.en-vi.err_after_fallback        | 0.030 ✓ (n=1227)    | 0.037 ✓ (n=1227)    | 0.033 ✓ (n=1227)    | <=0.05                                  | real+cv     |
| A2.en-vi.rerecorded                | 1.000 · (n=24)      | 1.000 · (n=24)      | 1.000 · (n=24)      | report                                  | rerecorded  |
| A2.en-vi.vietmed                   | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| A2.en-vi.vietmed-cut               | 0.936 · (n=282)     | 0.922 · (n=282)     | 0.922 · (n=282)     | report                                  | vietmed-cut |
| A2.en-vi.vimedcss                  | 1.000 · (n=4)       | 1.000 · (n=4)       | 1.000 · (n=4)       | report                                  | vimedcss    |
| A2.en-zh                           | 0.892 ✗ (n=2094)    | 0.892 ✗ (n=2094)    | 0.892 ✗ (n=2094)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-zh.ascend                    | 0.875 · (n=1374)    | 0.875 · (n=1374)    | 0.890 · (n=1374)    | report                                  | ascend      |
| A2.en-zh.edacc                     | 0.926 · (n=676)     | 0.923 · (n=676)     | 0.923 · (n=676)     | report                                  | edacc       |
| A2.en-zh.err_after_fallback        | 0.108 ✗ (n=2094)    | 0.109 ✗ (n=2094)    | 0.099 ✗ (n=2094)    | <=0.05                                  | real+cv     |
| A2.en-zh.rerecorded                | 0.909 · (n=44)      | 0.909 · (n=44)      | 0.909 · (n=44)      | report                                  | rerecorded  |
| A2.vi-zh                           | 0.950 ✓ (n=440)     | 0.950 ✓ (n=440)     | 0.950 ✓ (n=440)     | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.vi-zh.ascend                    | 0.948 · (n=116)     | 0.948 · (n=116)     | 0.948 · (n=116)     | report                                  | ascend      |
| A2.vi-zh.err_after_fallback        | 0.050 ✗ (n=440)     | 0.048 ✓ (n=440)     | 0.048 ✓ (n=440)     | <=0.05                                  | real+cv     |
| A2.vi-zh.rerecorded                | 1.000 · (n=32)      | 0.969 · (n=32)      | 0.969 · (n=32)      | report                                  | rerecorded  |
| A2.vi-zh.vietmed                   | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| A2.vi-zh.vietmed-cut               | 0.943 · (n=282)     | 0.950 · (n=282)     | 0.950 · (n=282)     | report                                  | vietmed-cut |
| A2.vi-zh.vimedcss                  | 1.000 · (n=4)       | 1.000 · (n=4)       | 1.000 · (n=4)       | report                                  | vimedcss    |
| A3.long.by_lang.en                 | 0.979 · (n=1623)    | 0.978 · (n=1623)    | 0.982 · (n=1623)    | report                                  | real        |
| A3.long.by_lang.vi                 | 0.983 · (n=2305)    | 0.982 · (n=2305)    | 0.984 · (n=2305)    | report                                  | real        |
| A3.long.by_lang.zh                 | 0.986 · (n=635)     | 0.986 · (n=635)     | 0.987 · (n=635)     | report                                  | real        |
| A3.long.vien                       | 0.981 ✓ (n=3928)    | 0.980 ✓ (n=3928)    | 0.983 ✓ (n=3928)    | >=0.95                                  | real        |
| A3.long.zh                         | 0.992 ✓ (n=1135)    | 0.992 ✓ (n=1135)    | 0.993 ✓ (n=1135)    | >=0.95                                  | mixed       |
| A3.short.by_lang.en                | 0.877 · (n=790)     | 0.872 · (n=790)     | 0.891 · (n=790)     | report                                  | real        |
| A3.short.by_lang.en.ascend         | 0.870 · (n=208)     | 0.870 · (n=208)     | 0.894 · (n=208)     | report                                  | ascend      |
| A3.short.by_lang.en.edacc          | 0.880 · (n=573)     | 0.873 · (n=573)     | 0.890 · (n=573)     | report                                  | edacc       |
| A3.short.by_lang.en.rerecorded     | 0.889 · (n=9)       | 0.889 · (n=9)       | 0.889 · (n=9)       | report                                  | rerecorded  |
| A3.short.by_lang.vi                | 0.933 · (n=149)     | 0.933 · (n=149)     | 0.933 · (n=149)     | report                                  | real        |
| A3.short.by_lang.vi.rerecorded     | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | rerecorded  |
| A3.short.by_lang.vi.vietmed        | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | vietmed     |
| A3.short.by_lang.vi.vietmed-cut    | 0.929 · (n=141)     | 0.929 · (n=141)     | 0.929 · (n=141)     | report                                  | vietmed-cut |
| A3.short.by_lang.vi.vimedcss       | 1.000 · (n=2)       | 1.000 · (n=2)       | 1.000 · (n=2)       | report                                  | vimedcss    |
| A3.short.by_lang.zh                | 0.850 · (n=492)     | 0.850 · (n=492)     | 0.878 · (n=492)     | report                                  | real        |
| A3.short.by_lang.zh.ascend         | 0.848 · (n=479)     | 0.848 · (n=479)     | 0.877 · (n=479)     | report                                  | ascend      |
| A3.short.by_lang.zh.rerecorded     | 0.923 · (n=13)      | 0.923 · (n=13)      | 0.923 · (n=13)      | report                                  | rerecorded  |
| A3.short.vien                      | 0.886 ✓ (n=939)     | 0.882 ✓ (n=939)     | 0.898 ✓ (n=939)     | >=0.85                                  | real        |
| A3.short.zh                        | 0.850 ✗ (n=492)     | 0.850 ✗ (n=492)     | 0.878 ✓ (n=492)     | >=0.85                                  | real        |
| A4                                 | 0.963 ✓ (n=1833)    | 0.963 ✓ (n=1833)    | 0.963 ✓ (n=1833)    | >=0.95                                  | real        |
| A5                                 | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | >=0.90 rejected                         | esc50+real  |
| A5.esc50                           | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| A5.real                            | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| A6.en-vi.changed                   | 0.079 ✓ (n=6618)    | 0.078 ✓ (n=6618)    | 0.078 ✓ (n=6618)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms     | 2400.000 ✓ (n=6813) | 2400.000 ✓ (n=6813) | 2400.000 ✓ (n=6813) | <=3500                                  | real        |
| A6.en-zh.changed                   | 0.026 ✓ (n=6156)    | 0.026 ✓ (n=6156)    | 0.031 ✓ (n=6156)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms     | 2134.738 ✓ (n=6426) | 2134.738 ✓ (n=6426) | 2131.572 ✓ (n=6426) | <=3500                                  | mixed       |
| A6.vi-zh.changed                   | 0.042 ✓ (n=3894)    | 0.042 ✓ (n=3894)    | 0.041 ✓ (n=3894)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms     | 2107.931 ✓ (n=3908) | 2107.931 ✓ (n=3908) | 2107.931 ✓ (n=3908) | <=3500                                  | mixed       |
| A7                                 | 129.290 ✓ (n=29672) | 129.290 ✓ (n=29672) | 129.290 ✓ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                         | 0.014 ✓ (n=138)     | 0.014 ✓ (n=138)     | 0.014 ✓ (n=138)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                         | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| detect2v3.short.en                 | -0.110 ✗ (n=790)    | -0.115 ✗ (n=790)    | -0.099 ✗ (n=790)    | >=-0.02                                 | real        |
| detect2v3.short.vi                 | 0.188 ✓ (n=149)     | 0.188 ✓ (n=149)     | 0.188 ✓ (n=149)     | >=-0.02                                 | real        |
| excluded.en                        | 0.188 · (n=2970)    | 0.188 · (n=2970)    | 0.188 · (n=2970)    | report                                  | real        |
| excluded.vi                        | 0.009 · (n=2476)    | 0.009 · (n=2476)    | 0.009 · (n=2476)    | report                                  | real        |
| excluded.zh                        | 0.195 · (n=1400)    | 0.195 · (n=1400)    | 0.195 · (n=1400)    | report                                  | real        |
| lock.en-vi.accuracy                | 0.907 · (n=5892)    | 0.907 · (n=5892)    | 0.907 · (n=5892)    | report                                  | real        |
| lock.en-zh.accuracy                | 0.965 · (n=4874)    | 0.965 · (n=4874)    | 0.962 · (n=4906)    | report                                  | mixed       |
| lock.vi-zh.accuracy                | 0.958 · (n=3708)    | 0.958 · (n=3708)    | 0.958 · (n=3710)    | report                                  | mixed       |
| v4.A-ACC.detect                    | 0.967 · (n=604)     | 0.964 · (n=604)     | 0.980 · (n=604)     | report                                  | public      |
| v4.A-ACC.pair                      | 0.976 · (n=616)     | 0.974 · (n=616)     | 0.984 · (n=616)     | report                                  | public      |
| v4.A1.en-vi                        | 0.985 · (n=5612)    | 0.985 · (n=5612)    | 0.986 · (n=5612)    | report                                  | real        |
| v4.A1.en-zh                        | 0.989 · (n=4334)    | 0.989 · (n=4334)    | 0.989 · (n=4334)    | report                                  | mixed       |
| v4.A1.vi-zh                        | 0.986 · (n=3492)    | 0.986 · (n=3492)    | 0.986 · (n=3492)    | report                                  | mixed       |
| v4.A2.en-vi                        | 0.971 · (n=2050)    | 0.971 · (n=2050)    | 0.971 · (n=2050)    | report                                  | real+cv     |
| v4.A2.en-vi.edacc                  | 0.983 · (n=1682)    | 0.979 · (n=1682)    | 0.983 · (n=1682)    | report                                  | edacc       |
| v4.A2.en-vi.err_after_fallback     | 0.029 · (n=2050)    | 0.034 · (n=2050)    | 0.031 · (n=2050)    | report                                  | real+cv     |
| v4.A2.en-vi.rerecorded             | 1.000 · (n=56)      | 1.000 · (n=56)      | 1.000 · (n=56)      | report                                  | rerecorded  |
| v4.A2.en-vi.vietmed                | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| v4.A2.en-vi.vietmed-cut            | 0.900 · (n=300)     | 0.890 · (n=300)     | 0.890 · (n=300)     | report                                  | vietmed-cut |
| v4.A2.en-vi.vimedcss               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| v4.A2.en-zh                        | 0.797 · (n=3314)    | 0.797 · (n=3314)    | 0.797 · (n=3314)    | report                                  | real+cv     |
| v4.A2.en-zh.ascend                 | 0.733 · (n=1982)    | 0.733 · (n=1982)    | 0.749 · (n=1982)    | report                                  | ascend      |
| v4.A2.en-zh.edacc                  | 0.899 · (n=1228)    | 0.896 · (n=1228)    | 0.896 · (n=1228)    | report                                  | edacc       |
| v4.A2.en-zh.err_after_fallback     | 0.203 · (n=3314)    | 0.204 · (n=3314)    | 0.195 · (n=3314)    | report                                  | real+cv     |
| v4.A2.en-zh.rerecorded             | 0.808 · (n=104)     | 0.817 · (n=104)     | 0.817 · (n=104)     | report                                  | rerecorded  |
| v4.A2.vi-zh                        | 0.908 · (n=524)     | 0.908 · (n=524)     | 0.908 · (n=524)     | report                                  | real+cv     |
| v4.A2.vi-zh.ascend                 | 0.895 · (n=152)     | 0.895 · (n=152)     | 0.908 · (n=152)     | report                                  | ascend      |
| v4.A2.vi-zh.err_after_fallback     | 0.092 · (n=524)     | 0.088 · (n=524)     | 0.084 · (n=524)     | report                                  | real+cv     |
| v4.A2.vi-zh.rerecorded             | 0.933 · (n=60)      | 0.917 · (n=60)      | 0.917 · (n=60)      | report                                  | rerecorded  |
| v4.A2.vi-zh.vietmed                | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| v4.A2.vi-zh.vietmed-cut            | 0.913 · (n=300)     | 0.923 · (n=300)     | 0.923 · (n=300)     | report                                  | vietmed-cut |
| v4.A2.vi-zh.vimedcss               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| v4.A3.long.by_lang.en              | 0.979 · (n=1624)    | 0.978 · (n=1624)    | 0.982 · (n=1624)    | report                                  | real        |
| v4.A3.long.by_lang.vi              | 0.981 · (n=2317)    | 0.981 · (n=2317)    | 0.982 · (n=2317)    | report                                  | real        |
| v4.A3.long.by_lang.zh              | 0.986 · (n=635)     | 0.986 · (n=635)     | 0.987 · (n=635)     | report                                  | real        |
| v4.A3.long.vien                    | 0.980 · (n=3941)    | 0.980 · (n=3941)    | 0.982 · (n=3941)    | report                                  | real        |
| v4.A3.long.zh                      | 0.992 · (n=1135)    | 0.992 · (n=1135)    | 0.993 · (n=1135)    | report                                  | mixed       |
| v4.A3.short.by_lang.en             | 0.854 · (n=1346)    | 0.852 · (n=1346)    | 0.867 · (n=1346)    | report                                  | real        |
| v4.A3.short.by_lang.en.ascend      | 0.862 · (n=253)     | 0.862 · (n=253)     | 0.889 · (n=253)     | report                                  | ascend      |
| v4.A3.short.by_lang.en.edacc       | 0.849 · (n=1068)    | 0.847 · (n=1068)    | 0.860 · (n=1068)    | report                                  | edacc       |
| v4.A3.short.by_lang.en.rerecorded  | 0.960 · (n=25)      | 0.960 · (n=25)      | 0.960 · (n=25)      | report                                  | rerecorded  |
| v4.A3.short.by_lang.vi             | 0.899 · (n=159)     | 0.899 · (n=159)     | 0.899 · (n=159)     | report                                  | real        |
| v4.A3.short.by_lang.vi.rerecorded  | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | rerecorded  |
| v4.A3.short.by_lang.vi.vietmed     | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | vietmed     |
| v4.A3.short.by_lang.vi.vietmed-cut | 0.900 · (n=150)     | 0.900 · (n=150)     | 0.900 · (n=150)     | report                                  | vietmed-cut |
| v4.A3.short.by_lang.vi.vimedcss    | 0.667 · (n=3)       | 0.667 · (n=3)       | 0.667 · (n=3)       | report                                  | vimedcss    |
| v4.A3.short.by_lang.zh             | 0.638 · (n=765)     | 0.638 · (n=765)     | 0.684 · (n=765)     | report                                  | real        |
| v4.A3.short.by_lang.zh.ascend      | 0.637 · (n=738)     | 0.637 · (n=738)     | 0.684 · (n=738)     | report                                  | ascend      |
| v4.A3.short.by_lang.zh.rerecorded  | 0.667 · (n=27)      | 0.667 · (n=27)      | 0.667 · (n=27)      | report                                  | rerecorded  |
| v4.A3.short.vien                   | 0.858 · (n=1505)    | 0.857 · (n=1505)    | 0.870 · (n=1505)    | report                                  | real        |
| v4.A3.short.zh                     | 0.638 · (n=765)     | 0.638 · (n=765)     | 0.684 · (n=765)     | report                                  | real        |
| v4.A4                              | 0.963 · (n=1833)    | 0.963 · (n=1833)    | 0.963 · (n=1833)    | report                                  | real        |
| v4.A5                              | 0.906 · (n=160)     | 0.906 · (n=160)     | 0.906 · (n=160)     | report                                  | esc50+real  |
| v4.A5.esc50                        | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| v4.A5.real                         | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| v4.A6.en-vi.changed                | 0.078 · (n=6758)    | 0.078 · (n=6758)    | 0.077 · (n=6758)    | report                                  | real        |
| v4.A6.en-vi.first_language_p95_ms  | 2146.617 · (n=7662) | 2146.617 · (n=7662) | 2146.617 · (n=7662) | report                                  | real        |
| v4.A6.en-zh.changed                | 0.025 · (n=6428)    | 0.024 · (n=6428)    | 0.030 · (n=6428)    | report                                  | mixed       |
| v4.A6.en-zh.first_language_p95_ms  | 2124.540 · (n=7648) | 2124.540 · (n=7648) | 2121.750 · (n=7648) | report                                  | mixed       |
| v4.A6.vi-zh.changed                | 0.043 · (n=3952)    | 0.043 · (n=3952)    | 0.043 · (n=3952)    | report                                  | mixed       |
| v4.A6.vi-zh.first_language_p95_ms  | 2107.730 · (n=4016) | 2107.730 · (n=4016) | 2107.730 · (n=4016) | report                                  | mixed       |
| v4.A7                              | 129.290 · (n=29672) | 129.290 · (n=29672) | 129.290 · (n=29672) | report                                  | mixed       |
| v4.A9-mono.en                      | 0.010 · (n=200)     | 0.010 · (n=200)     | 0.010 · (n=200)     | report                                  | real        |
| v4.A9-mono.vi                      | 0.000 · (n=200)     | 0.000 · (n=200)     | 0.000 · (n=200)     | report                                  | real        |
| v4.detect2v3.short.en              | -0.137 · (n=1346)   | -0.139 · (n=1346)   | -0.126 · (n=1346)   | report                                  | real        |
| v4.detect2v3.short.vi              | 0.182 · (n=159)     | 0.182 · (n=159)     | 0.182 · (n=159)     | report                                  | real        |
| v4.lock.en-vi.accuracy             | 0.905 · (n=5928)    | 0.905 · (n=5928)    | 0.905 · (n=5928)    | report                                  | real        |
| v4.lock.en-zh.accuracy             | 0.965 · (n=4880)    | 0.965 · (n=4880)    | 0.961 · (n=4912)    | report                                  | mixed       |
| v4.lock.vi-zh.accuracy             | 0.957 · (n=3738)    | 0.957 · (n=3738)    | 0.957 · (n=3740)    | report                                  | mixed       |
| v4.zh_real.A1.en-zh                | 0.986 · (n=1270)    | 0.986 · (n=1270)    | 0.987 · (n=1270)    | report                                  | real        |
| v4.zh_real.A1.vi-zh                | 1.000 · (n=150)     | 1.000 · (n=150)     | 1.000 · (n=150)     | report                                  | real        |
| v4.zh_real.A3                      | 0.796 · (n=1400)    | 0.796 · (n=1400)    | 0.821 · (n=1400)    | report                                  | real        |
| zh_real.A1.en-zh                   | 0.986 · (n=1270)    | 0.986 · (n=1270)    | 0.987 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh                   | 1.000 · (n=150)     | 1.000 · (n=150)     | 1.000 · (n=150)     | report                                  | real        |
| zh_real.A3                         | 0.796 · (n=1400)    | 0.796 · (n=1400)    | 0.821 · (n=1400)    | report                                  | real        |
