# LID bake-off `probe-fusion` (ruler v5)

Outcome: **INCOMPLETE**

## fusion_ctx5_ambernet (cv None, tau_noise 0.0)

| criterion                          | bare                | src                 | src+voice           | threshold                               | data        |
| ---------------------------------- | ------------------- | ------------------- | ------------------- | --------------------------------------- | ----------- |
| A-ACC.detect                       | 0.828 ✗ (n=604)     | 0.801 ✗ (n=604)     | 0.841 ✗ (n=604)     | >=0.95                                  | public      |
| A-ACC.pair                         | 0.844 ✗ (n=616)     | 0.833 ✗ (n=616)     | 0.857 ✗ (n=616)     | >=0.95                                  | public      |
| A1.en-vi                           | 0.981 ✓ (n=5586)    | 0.980 ✓ (n=5586)    | 0.982 ✓ (n=5586)    | >=0.97                                  | real        |
| A1.en-zh                           | 0.988 ✓ (n=4332)    | 0.986 ✓ (n=4332)    | 0.985 ✓ (n=4332)    | >=0.97                                  | mixed       |
| A1.vi-zh                           | 0.997 ✓ (n=3468)    | 0.997 ✓ (n=3468)    | 0.997 ✓ (n=3468)    | >=0.97                                  | mixed       |
| A2.en-vi                           | 0.958 ✓ (n=1227)    | 0.958 ✓ (n=1227)    | 0.958 ✓ (n=1227)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-vi.edacc                     | 0.954 · (n=911)     | 0.950 · (n=911)     | 0.948 · (n=911)     | report                                  | edacc       |
| A2.en-vi.err_after_fallback        | 0.042 ✓ (n=1227)    | 0.046 ✓ (n=1227)    | 0.048 ✓ (n=1227)    | <=0.05                                  | real+cv     |
| A2.en-vi.rerecorded                | 1.000 · (n=24)      | 1.000 · (n=24)      | 0.958 · (n=24)      | report                                  | rerecorded  |
| A2.en-vi.vietmed                   | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| A2.en-vi.vietmed-cut               | 0.965 · (n=282)     | 0.961 · (n=282)     | 0.961 · (n=282)     | report                                  | vietmed-cut |
| A2.en-vi.vimedcss                  | 1.000 · (n=4)       | 1.000 · (n=4)       | 1.000 · (n=4)       | report                                  | vimedcss    |
| A2.en-zh                           | 0.892 ✗ (n=2094)    | 0.892 ✗ (n=2094)    | 0.892 ✗ (n=2094)    | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.en-zh.ascend                    | 0.875 · (n=1374)    | 0.875 · (n=1374)    | 0.890 · (n=1374)    | report                                  | ascend      |
| A2.en-zh.edacc                     | 0.926 · (n=676)     | 0.926 · (n=676)     | 0.917 · (n=676)     | report                                  | edacc       |
| A2.en-zh.err_after_fallback        | 0.108 ✗ (n=2094)    | 0.108 ✗ (n=2094)    | 0.101 ✗ (n=2094)    | <=0.05                                  | real+cv     |
| A2.en-zh.rerecorded                | 0.909 · (n=44)      | 0.909 · (n=44)      | 0.909 · (n=44)      | report                                  | rerecorded  |
| A2.vi-zh                           | 0.950 ✓ (n=440)     | 0.950 ✓ (n=440)     | 0.950 ✓ (n=440)     | >=0.90 raw OR <=0.05 err after fallback | real+cv     |
| A2.vi-zh.ascend                    | 0.948 · (n=116)     | 0.948 · (n=116)     | 0.948 · (n=116)     | report                                  | ascend      |
| A2.vi-zh.err_after_fallback        | 0.050 ✗ (n=440)     | 0.048 ✓ (n=440)     | 0.048 ✓ (n=440)     | <=0.05                                  | real+cv     |
| A2.vi-zh.rerecorded                | 1.000 · (n=32)      | 1.000 · (n=32)      | 0.969 · (n=32)      | report                                  | rerecorded  |
| A2.vi-zh.vietmed                   | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| A2.vi-zh.vietmed-cut               | 0.943 · (n=282)     | 0.947 · (n=282)     | 0.950 · (n=282)     | report                                  | vietmed-cut |
| A2.vi-zh.vimedcss                  | 1.000 · (n=4)       | 1.000 · (n=4)       | 1.000 · (n=4)       | report                                  | vimedcss    |
| A3.long.by_lang.en                 | 0.922 · (n=1623)    | 0.913 · (n=1623)    | 0.928 · (n=1623)    | report                                  | real        |
| A3.long.by_lang.vi                 | 0.997 · (n=2305)    | 0.997 · (n=2305)    | 0.997 · (n=2305)    | report                                  | real        |
| A3.long.by_lang.zh                 | 0.994 · (n=635)     | 0.994 · (n=635)     | 0.994 · (n=635)     | report                                  | real        |
| A3.long.vien                       | 0.966 ✓ (n=3928)    | 0.962 ✓ (n=3928)    | 0.969 ✓ (n=3928)    | >=0.95                                  | real        |
| A3.long.zh                         | 0.996 ✓ (n=1135)    | 0.996 ✓ (n=1135)    | 0.996 ✓ (n=1135)    | >=0.95                                  | mixed       |
| A3.short.by_lang.en                | 0.877 · (n=790)     | 0.870 · (n=790)     | 0.891 · (n=790)     | report                                  | real        |
| A3.short.by_lang.en.ascend         | 0.870 · (n=208)     | 0.870 · (n=208)     | 0.894 · (n=208)     | report                                  | ascend      |
| A3.short.by_lang.en.edacc          | 0.880 · (n=573)     | 0.869 · (n=573)     | 0.890 · (n=573)     | report                                  | edacc       |
| A3.short.by_lang.en.rerecorded     | 0.889 · (n=9)       | 0.889 · (n=9)       | 0.889 · (n=9)       | report                                  | rerecorded  |
| A3.short.by_lang.vi                | 0.933 · (n=149)     | 0.933 · (n=149)     | 0.933 · (n=149)     | report                                  | real        |
| A3.short.by_lang.vi.rerecorded     | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | rerecorded  |
| A3.short.by_lang.vi.vietmed        | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | vietmed     |
| A3.short.by_lang.vi.vietmed-cut    | 0.929 · (n=141)     | 0.929 · (n=141)     | 0.929 · (n=141)     | report                                  | vietmed-cut |
| A3.short.by_lang.vi.vimedcss       | 1.000 · (n=2)       | 1.000 · (n=2)       | 1.000 · (n=2)       | report                                  | vimedcss    |
| A3.short.by_lang.zh                | 0.850 · (n=492)     | 0.850 · (n=492)     | 0.870 · (n=492)     | report                                  | real        |
| A3.short.by_lang.zh.ascend         | 0.848 · (n=479)     | 0.848 · (n=479)     | 0.868 · (n=479)     | report                                  | ascend      |
| A3.short.by_lang.zh.rerecorded     | 0.923 · (n=13)      | 0.923 · (n=13)      | 0.923 · (n=13)      | report                                  | rerecorded  |
| A3.short.vien                      | 0.886 ✓ (n=939)     | 0.880 ✓ (n=939)     | 0.898 ✓ (n=939)     | >=0.85                                  | real        |
| A3.short.zh                        | 0.850 ✗ (n=492)     | 0.850 ✗ (n=492)     | 0.870 ✓ (n=492)     | >=0.85                                  | real        |
| A4                                 | 0.989 ✓ (n=1833)    | 0.989 ✓ (n=1833)    | 0.989 ✓ (n=1833)    | >=0.95                                  | real        |
| A5                                 | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | 0.906 ✓ (n=160)     | >=0.90 rejected                         | esc50+real  |
| A5.esc50                           | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| A5.real                            | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| A6.en-vi.changed                   | 0.061 ✓ (n=6618)    | 0.062 ✓ (n=6618)    | 0.061 ✓ (n=6618)    | <=0.10                                  | real        |
| A6.en-vi.first_language_p95_ms     | 2128.030 ✓ (n=6813) | 2127.542 ✓ (n=6813) | 2128.030 ✓ (n=6813) | <=3500                                  | real        |
| A6.en-zh.changed                   | 0.038 ✓ (n=6156)    | 0.038 ✓ (n=6156)    | 0.039 ✓ (n=6156)    | <=0.10                                  | mixed       |
| A6.en-zh.first_language_p95_ms     | 2123.198 ✓ (n=6426) | 2123.198 ✓ (n=6426) | 2123.198 ✓ (n=6426) | <=3500                                  | mixed       |
| A6.vi-zh.changed                   | 0.045 ✓ (n=3894)    | 0.045 ✓ (n=3894)    | 0.045 ✓ (n=3894)    | <=0.10                                  | mixed       |
| A6.vi-zh.first_language_p95_ms     | 1633.881 ✓ (n=3908) | 1633.881 ✓ (n=3908) | 1633.881 ✓ (n=3908) | <=3500                                  | mixed       |
| A7                                 | 350.780 ✗ (n=29672) | 350.780 ✗ (n=29672) | 350.780 ✗ (n=29672) | <=150 ms p95                            | mixed       |
| A9-mono.en                         | 0.029 ✓ (n=138)     | 0.029 ✓ (n=138)     | 0.014 ✓ (n=138)     | <=0.03 err (worst source)               | real        |
| A9-mono.vi                         | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real        |
| detect2v3.short.en                 | -0.081 ✗ (n=790)    | -0.086 ✗ (n=790)    | -0.073 ✗ (n=790)    | >=-0.02                                 | real        |
| detect2v3.short.vi                 | -0.034 ✗ (n=149)    | -0.034 ✗ (n=149)    | -0.034 ✗ (n=149)    | >=-0.02                                 | real        |
| excluded.en                        | 0.188 · (n=2970)    | 0.188 · (n=2970)    | 0.188 · (n=2970)    | report                                  | real        |
| excluded.vi                        | 0.009 · (n=2476)    | 0.009 · (n=2476)    | 0.009 · (n=2476)    | report                                  | real        |
| excluded.zh                        | 0.195 · (n=1400)    | 0.195 · (n=1400)    | 0.195 · (n=1400)    | report                                  | real        |
| lock.en-vi.accuracy                | 0.932 · (n=6068)    | 0.932 · (n=6068)    | 0.932 · (n=6068)    | report                                  | real        |
| lock.en-zh.accuracy                | 0.953 · (n=5280)    | 0.952 · (n=5277)    | 0.953 · (n=5280)    | report                                  | mixed       |
| lock.vi-zh.accuracy                | 0.950 · (n=3810)    | 0.950 · (n=3810)    | 0.950 · (n=3810)    | report                                  | mixed       |
| v4.A-ACC.detect                    | 0.828 · (n=604)     | 0.801 · (n=604)     | 0.841 · (n=604)     | report                                  | public      |
| v4.A-ACC.pair                      | 0.844 · (n=616)     | 0.833 · (n=616)     | 0.857 · (n=616)     | report                                  | public      |
| v4.A1.en-vi                        | 0.981 · (n=5612)    | 0.980 · (n=5612)    | 0.982 · (n=5612)    | report                                  | real        |
| v4.A1.en-zh                        | 0.988 · (n=4334)    | 0.986 · (n=4334)    | 0.985 · (n=4334)    | report                                  | mixed       |
| v4.A1.vi-zh                        | 0.996 · (n=3492)    | 0.996 · (n=3492)    | 0.996 · (n=3492)    | report                                  | mixed       |
| v4.A2.en-vi                        | 0.944 · (n=2050)    | 0.944 · (n=2050)    | 0.944 · (n=2050)    | report                                  | real+cv     |
| v4.A2.en-vi.edacc                  | 0.944 · (n=1682)    | 0.941 · (n=1682)    | 0.932 · (n=1682)    | report                                  | edacc       |
| v4.A2.en-vi.err_after_fallback     | 0.056 · (n=2050)    | 0.060 · (n=2050)    | 0.067 · (n=2050)    | report                                  | real+cv     |
| v4.A2.en-vi.rerecorded             | 1.000 · (n=56)      | 0.982 · (n=56)      | 0.964 · (n=56)      | report                                  | rerecorded  |
| v4.A2.en-vi.vietmed                | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| v4.A2.en-vi.vietmed-cut            | 0.940 · (n=300)     | 0.937 · (n=300)     | 0.937 · (n=300)     | report                                  | vietmed-cut |
| v4.A2.en-vi.vimedcss               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| v4.A2.en-zh                        | 0.797 · (n=3314)    | 0.797 · (n=3314)    | 0.797 · (n=3314)    | report                                  | real+cv     |
| v4.A2.en-zh.ascend                 | 0.733 · (n=1982)    | 0.733 · (n=1982)    | 0.749 · (n=1982)    | report                                  | ascend      |
| v4.A2.en-zh.edacc                  | 0.899 · (n=1228)    | 0.896 · (n=1228)    | 0.879 · (n=1228)    | report                                  | edacc       |
| v4.A2.en-zh.err_after_fallback     | 0.203 · (n=3314)    | 0.205 · (n=3314)    | 0.201 · (n=3314)    | report                                  | real+cv     |
| v4.A2.en-zh.rerecorded             | 0.808 · (n=104)     | 0.808 · (n=104)     | 0.817 · (n=104)     | report                                  | rerecorded  |
| v4.A2.vi-zh                        | 0.908 · (n=524)     | 0.908 · (n=524)     | 0.908 · (n=524)     | report                                  | real+cv     |
| v4.A2.vi-zh.ascend                 | 0.895 · (n=152)     | 0.895 · (n=152)     | 0.908 · (n=152)     | report                                  | ascend      |
| v4.A2.vi-zh.err_after_fallback     | 0.092 · (n=524)     | 0.090 · (n=524)     | 0.084 · (n=524)     | report                                  | real+cv     |
| v4.A2.vi-zh.rerecorded             | 0.933 · (n=60)      | 0.933 · (n=60)      | 0.917 · (n=60)      | report                                  | rerecorded  |
| v4.A2.vi-zh.vietmed                | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed     |
| v4.A2.vi-zh.vietmed-cut            | 0.913 · (n=300)     | 0.917 · (n=300)     | 0.923 · (n=300)     | report                                  | vietmed-cut |
| v4.A2.vi-zh.vimedcss               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss    |
| v4.A3.long.by_lang.en              | 0.922 · (n=1624)    | 0.913 · (n=1624)    | 0.928 · (n=1624)    | report                                  | real        |
| v4.A3.long.by_lang.vi              | 0.997 · (n=2317)    | 0.997 · (n=2317)    | 0.997 · (n=2317)    | report                                  | real        |
| v4.A3.long.by_lang.zh              | 0.994 · (n=635)     | 0.994 · (n=635)     | 0.994 · (n=635)     | report                                  | real        |
| v4.A3.long.vien                    | 0.966 · (n=3941)    | 0.962 · (n=3941)    | 0.969 · (n=3941)    | report                                  | real        |
| v4.A3.long.zh                      | 0.996 · (n=1135)    | 0.996 · (n=1135)    | 0.996 · (n=1135)    | report                                  | mixed       |
| v4.A3.short.by_lang.en             | 0.854 · (n=1346)    | 0.851 · (n=1346)    | 0.868 · (n=1346)    | report                                  | real        |
| v4.A3.short.by_lang.en.ascend      | 0.862 · (n=253)     | 0.862 · (n=253)     | 0.889 · (n=253)     | report                                  | ascend      |
| v4.A3.short.by_lang.en.edacc       | 0.849 · (n=1068)    | 0.846 · (n=1068)    | 0.861 · (n=1068)    | report                                  | edacc       |
| v4.A3.short.by_lang.en.rerecorded  | 0.960 · (n=25)      | 0.960 · (n=25)      | 0.960 · (n=25)      | report                                  | rerecorded  |
| v4.A3.short.by_lang.vi             | 0.899 · (n=159)     | 0.899 · (n=159)     | 0.899 · (n=159)     | report                                  | real        |
| v4.A3.short.by_lang.vi.rerecorded  | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | rerecorded  |
| v4.A3.short.by_lang.vi.vietmed     | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | vietmed     |
| v4.A3.short.by_lang.vi.vietmed-cut | 0.900 · (n=150)     | 0.900 · (n=150)     | 0.900 · (n=150)     | report                                  | vietmed-cut |
| v4.A3.short.by_lang.vi.vimedcss    | 0.667 · (n=3)       | 0.667 · (n=3)       | 0.667 · (n=3)       | report                                  | vimedcss    |
| v4.A3.short.by_lang.zh             | 0.638 · (n=765)     | 0.638 · (n=765)     | 0.669 · (n=765)     | report                                  | real        |
| v4.A3.short.by_lang.zh.ascend      | 0.637 · (n=738)     | 0.637 · (n=738)     | 0.669 · (n=738)     | report                                  | ascend      |
| v4.A3.short.by_lang.zh.rerecorded  | 0.667 · (n=27)      | 0.667 · (n=27)      | 0.667 · (n=27)      | report                                  | rerecorded  |
| v4.A3.short.vien                   | 0.858 · (n=1505)    | 0.856 · (n=1505)    | 0.872 · (n=1505)    | report                                  | real        |
| v4.A3.short.zh                     | 0.638 · (n=765)     | 0.638 · (n=765)     | 0.669 · (n=765)     | report                                  | real        |
| v4.A4                              | 0.989 · (n=1833)    | 0.989 · (n=1833)    | 0.989 · (n=1833)    | report                                  | real        |
| v4.A5                              | 0.906 · (n=160)     | 0.906 · (n=160)     | 0.906 · (n=160)     | report                                  | esc50+real  |
| v4.A5.esc50                        | 0.900 · (n=80)      | 0.900 · (n=80)      | 0.900 · (n=80)      | report                                  | esc50       |
| v4.A5.real                         | 0.912 · (n=80)      | 0.912 · (n=80)      | 0.912 · (n=80)      | report                                  | real        |
| v4.A6.en-vi.changed                | 0.061 · (n=6758)    | 0.062 · (n=6758)    | 0.061 · (n=6758)    | report                                  | real        |
| v4.A6.en-vi.first_language_p95_ms  | 2121.510 · (n=7662) | 2121.177 · (n=7662) | 2121.510 · (n=7662) | report                                  | real        |
| v4.A6.en-zh.changed                | 0.036 · (n=6428)    | 0.036 · (n=6428)    | 0.038 · (n=6428)    | report                                  | mixed       |
| v4.A6.en-zh.first_language_p95_ms  | 2112.570 · (n=7648) | 2112.590 · (n=7648) | 2112.570 · (n=7648) | report                                  | mixed       |
| v4.A6.vi-zh.changed                | 0.046 · (n=3952)    | 0.046 · (n=3952)    | 0.046 · (n=3952)    | report                                  | mixed       |
| v4.A6.vi-zh.first_language_p95_ms  | 1631.520 · (n=4016) | 1631.520 · (n=4016) | 1631.520 · (n=4016) | report                                  | mixed       |
| v4.A7                              | 350.780 · (n=29672) | 350.780 · (n=29672) | 350.780 · (n=29672) | report                                  | mixed       |
| v4.A9-mono.en                      | 0.020 · (n=200)     | 0.020 · (n=200)     | 0.010 · (n=200)     | report                                  | real        |
| v4.A9-mono.vi                      | 0.000 · (n=200)     | 0.000 · (n=200)     | 0.000 · (n=200)     | report                                  | real        |
| v4.detect2v3.short.en              | -0.091 · (n=1346)   | -0.091 · (n=1346)   | -0.082 · (n=1346)   | report                                  | real        |
| v4.detect2v3.short.vi              | -0.038 · (n=159)    | -0.038 · (n=159)    | -0.038 · (n=159)    | report                                  | real        |
| v4.lock.en-vi.accuracy             | 0.930 · (n=6114)    | 0.930 · (n=6114)    | 0.930 · (n=6114)    | report                                  | real        |
| v4.lock.en-zh.accuracy             | 0.948 · (n=5314)    | 0.948 · (n=5311)    | 0.948 · (n=5314)    | report                                  | mixed       |
| v4.lock.vi-zh.accuracy             | 0.948 · (n=3844)    | 0.948 · (n=3844)    | 0.948 · (n=3844)    | report                                  | mixed       |
| v4.zh_real.A1.en-zh                | 0.994 · (n=1270)    | 0.994 · (n=1270)    | 0.994 · (n=1270)    | report                                  | real        |
| v4.zh_real.A1.vi-zh                | 1.000 · (n=150)     | 1.000 · (n=150)     | 1.000 · (n=150)     | report                                  | real        |
| v4.zh_real.A3                      | 0.799 · (n=1400)    | 0.799 · (n=1400)    | 0.816 · (n=1400)    | report                                  | real        |
| zh_real.A1.en-zh                   | 0.994 · (n=1270)    | 0.994 · (n=1270)    | 0.994 · (n=1270)    | report                                  | real        |
| zh_real.A1.vi-zh                   | 1.000 · (n=150)     | 1.000 · (n=150)     | 1.000 · (n=150)     | report                                  | real        |
| zh_real.A3                         | 0.799 · (n=1400)    | 0.799 · (n=1400)    | 0.816 · (n=1400)    | report                                  | real        |
