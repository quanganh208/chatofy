# LID bake-off `conv-r5-decision` (ruler v5)

Outcome: **INCOMPLETE**

## whisper_probs_base_ctx5 (cv None, tau_noise 0.0)

| criterion                          | bare                | src                 | src+voice           | threshold                               | data                 |
| ---------------------------------- | ------------------- | ------------------- | ------------------- | --------------------------------------- | -------------------- |
| A-ACC.detect                       | 0.967 ✓ (n=604)     | 0.964 ✓ (n=604)     | 0.980 ✓ (n=604)     | >=0.95                                  | public               |
| A-ACC.pair                         | 0.976 ✓ (n=616)     | 0.976 ✓ (n=616)     | 0.984 ✓ (n=616)     | >=0.95                                  | public               |
| A1.en-vi                           | 0.986 ✓ (n=5586)    | 0.986 ✓ (n=5586)    | 0.987 ✓ (n=5586)    | >=0.97                                  | real                 |
| A1.en-zh                           | 0.989 ✓ (n=4332)    | 0.989 ✓ (n=4332)    | 0.987 ✓ (n=4332)    | >=0.97                                  | mixed                |
| A1.vi-zh                           | 0.987 ✓ (n=3468)    | 0.987 ✓ (n=3468)    | 0.987 ✓ (n=3468)    | >=0.97                                  | mixed                |
| A2.en-vi                           | 0.931 ✓ (n=1227)    | 0.931 ✓ (n=1227)    | 0.931 ✓ (n=1227)    | >=0.90 raw OR <=0.05 err after fallback | real+cv              |
| A2.en-vi.edacc                     | 0.990 · (n=911)     | 0.987 · (n=911)     | 0.984 · (n=911)     | report                                  | edacc                |
| A2.en-vi.err_after_fallback        | 0.069 ✗ (n=1227)    | 0.073 ✗ (n=1227)    | 0.076 ✗ (n=1227)    | <=0.05                                  | real+cv              |
| A2.en-vi.rerecorded                | 0.833 · (n=24)      | 0.875 · (n=24)      | 0.875 · (n=24)      | report                                  | rerecorded           |
| A2.en-vi.vietmed                   | 1.000 · (n=6)       | 0.833 · (n=6)       | 0.833 · (n=6)       | report                                  | vietmed              |
| A2.en-vi.vietmed-cut               | 0.745 · (n=282)     | 0.738 · (n=282)     | 0.738 · (n=282)     | report                                  | vietmed-cut          |
| A2.en-vi.vimedcss                  | 1.000 · (n=4)       | 1.000 · (n=4)       | 1.000 · (n=4)       | report                                  | vimedcss             |
| A2.en-zh                           | 0.862 ✗ (n=2094)    | 0.862 ✗ (n=2094)    | 0.862 ✗ (n=2094)    | >=0.90 raw OR <=0.05 err after fallback | real+cv              |
| A2.en-zh.ascend                    | 0.833 · (n=1374)    | 0.833 · (n=1374)    | 0.833 · (n=1374)    | report                                  | ascend               |
| A2.en-zh.edacc                     | 0.926 · (n=676)     | 0.926 · (n=676)     | 0.901 · (n=676)     | report                                  | edacc                |
| A2.en-zh.err_after_fallback        | 0.138 ✗ (n=2094)    | 0.137 ✗ (n=2094)    | 0.145 ✗ (n=2094)    | <=0.05                                  | real+cv              |
| A2.en-zh.rerecorded                | 0.818 · (n=44)      | 0.864 · (n=44)      | 0.864 · (n=44)      | report                                  | rerecorded           |
| A2.vi-zh                           | 0.818 ✗ (n=440)     | 0.818 ✗ (n=440)     | 0.818 ✗ (n=440)     | >=0.90 raw OR <=0.05 err after fallback | real+cv              |
| A2.vi-zh.ascend                    | 0.983 · (n=116)     | 0.983 · (n=116)     | 0.983 · (n=116)     | report                                  | ascend               |
| A2.vi-zh.err_after_fallback        | 0.182 ✗ (n=440)     | 0.189 ✗ (n=440)     | 0.189 ✗ (n=440)     | <=0.05                                  | real+cv              |
| A2.vi-zh.rerecorded                | 0.875 · (n=32)      | 0.844 · (n=32)      | 0.844 · (n=32)      | report                                  | rerecorded           |
| A2.vi-zh.vietmed                   | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed              |
| A2.vi-zh.vietmed-cut               | 0.738 · (n=282)     | 0.730 · (n=282)     | 0.730 · (n=282)     | report                                  | vietmed-cut          |
| A2.vi-zh.vimedcss                  | 1.000 · (n=4)       | 1.000 · (n=4)       | 1.000 · (n=4)       | report                                  | vimedcss             |
| A3.long.by_lang.en                 | 0.979 · (n=1623)    | 0.978 · (n=1623)    | 0.984 · (n=1623)    | report                                  | real                 |
| A3.long.by_lang.vi                 | 0.983 · (n=2305)    | 0.982 · (n=2305)    | 0.984 · (n=2305)    | report                                  | real                 |
| A3.long.by_lang.zh                 | 0.986 · (n=635)     | 0.986 · (n=635)     | 0.986 · (n=635)     | report                                  | real                 |
| A3.long.vien                       | 0.981 ✓ (n=3928)    | 0.980 ✓ (n=3928)    | 0.984 ✓ (n=3928)    | >=0.95                                  | real                 |
| A3.long.zh                         | 0.992 ✓ (n=1135)    | 0.992 ✓ (n=1135)    | 0.992 ✓ (n=1135)    | >=0.95                                  | mixed                |
| A3.short.by_lang.en                | 0.911 · (n=790)     | 0.913 · (n=790)     | 0.919 · (n=790)     | report                                  | real                 |
| A3.short.by_lang.en.ascend         | 0.880 · (n=208)     | 0.880 · (n=208)     | 0.880 · (n=208)     | report                                  | ascend               |
| A3.short.by_lang.en.edacc          | 0.923 · (n=573)     | 0.925 · (n=573)     | 0.934 · (n=573)     | report                                  | edacc                |
| A3.short.by_lang.en.rerecorded     | 0.889 · (n=9)       | 0.889 · (n=9)       | 0.889 · (n=9)       | report                                  | rerecorded           |
| A3.short.by_lang.vi                | 0.617 · (n=149)     | 0.617 · (n=149)     | 0.617 · (n=149)     | report                                  | real                 |
| A3.short.by_lang.vi.rerecorded     | 0.000 · (n=3)       | 0.000 · (n=3)       | 0.000 · (n=3)       | report                                  | rerecorded           |
| A3.short.by_lang.vi.vietmed        | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | vietmed              |
| A3.short.by_lang.vi.vietmed-cut    | 0.617 · (n=141)     | 0.617 · (n=141)     | 0.617 · (n=141)     | report                                  | vietmed-cut          |
| A3.short.by_lang.vi.vimedcss       | 1.000 · (n=2)       | 1.000 · (n=2)       | 1.000 · (n=2)       | report                                  | vimedcss             |
| A3.short.by_lang.zh                | 0.791 · (n=492)     | 0.791 · (n=492)     | 0.791 · (n=492)     | report                                  | real                 |
| A3.short.by_lang.zh.ascend         | 0.791 · (n=479)     | 0.791 · (n=479)     | 0.791 · (n=479)     | report                                  | ascend               |
| A3.short.by_lang.zh.rerecorded     | 0.769 · (n=13)      | 0.769 · (n=13)      | 0.769 · (n=13)      | report                                  | rerecorded           |
| A3.short.vien                      | 0.865 ✓ (n=939)     | 0.866 ✓ (n=939)     | 0.871 ✓ (n=939)     | >=0.85                                  | real                 |
| A3.short.zh                        | 0.791 ✗ (n=492)     | 0.791 ✗ (n=492)     | 0.791 ✗ (n=492)     | >=0.85                                  | real                 |
| A4                                 | 0.963 ✓ (n=1833)    | 0.963 ✓ (n=1833)    | 0.963 ✓ (n=1833)    | >=0.95                                  | real                 |
| A5                                 | —                   | —                   | —                   | >=0.90 rejected                         | missing silero facts |
| A6.en-vi.changed                   | 0.075 ✓ (n=6618)    | 0.074 ✓ (n=6618)    | 0.074 ✓ (n=6618)    | <=0.10                                  | real                 |
| A6.en-vi.first_language_p95_ms     | 3099.130 ✓ (n=6813) | 3099.130 ✓ (n=6813) | 3099.130 ✓ (n=6813) | <=3500                                  | real                 |
| A6.en-zh.changed                   | 0.010 ✓ (n=6156)    | 0.010 ✓ (n=6156)    | 0.010 ✓ (n=6156)    | <=0.10                                  | mixed                |
| A6.en-zh.first_language_p95_ms     | 3094.475 ✓ (n=6426) | 3094.475 ✓ (n=6426) | 3095.438 ✓ (n=6426) | <=3500                                  | mixed                |
| A6.vi-zh.changed                   | 0.085 ✓ (n=3894)    | 0.084 ✓ (n=3894)    | 0.084 ✓ (n=3894)    | <=0.10                                  | mixed                |
| A6.vi-zh.first_language_p95_ms     | 3086.382 ✓ (n=3908) | 3086.382 ✓ (n=3908) | 3086.382 ✓ (n=3908) | <=3500                                  | mixed                |
| A7                                 | 125.710 ✓ (n=29672) | 125.710 ✓ (n=29672) | 125.710 ✓ (n=29672) | <=150 ms p95                            | mixed                |
| A9-mono.en                         | 0.014 ✓ (n=138)     | 0.014 ✓ (n=138)     | 0.000 ✓ (n=138)     | <=0.03 err (worst source)               | real                 |
| A9-mono.vi                         | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real                 |
| detect2v3.short.en                 | -0.076 ✗ (n=790)    | -0.075 ✗ (n=790)    | -0.071 ✗ (n=790)    | >=-0.02                                 | real                 |
| detect2v3.short.vi                 | -0.128 ✗ (n=149)    | -0.128 ✗ (n=149)    | -0.128 ✗ (n=149)    | >=-0.02                                 | real                 |
| excluded.en                        | 0.188 · (n=2970)    | 0.188 · (n=2970)    | 0.188 · (n=2970)    | report                                  | real                 |
| excluded.vi                        | 0.009 · (n=2476)    | 0.009 · (n=2476)    | 0.009 · (n=2476)    | report                                  | real                 |
| excluded.zh                        | 0.195 · (n=1400)    | 0.195 · (n=1400)    | 0.195 · (n=1400)    | report                                  | real                 |
| lock.en-vi.accuracy                | 0.900 · (n=5297)    | 0.900 · (n=5297)    | 0.900 · (n=5297)    | report                                  | real                 |
| lock.en-zh.accuracy                | 0.981 · (n=4052)    | 0.981 · (n=4052)    | 0.982 · (n=4040)    | report                                  | mixed                |
| lock.vi-zh.accuracy                | 0.897 · (n=3440)    | 0.897 · (n=3440)    | 0.897 · (n=3440)    | report                                  | mixed                |
| v4.A-ACC.detect                    | 0.967 · (n=604)     | 0.964 · (n=604)     | 0.980 · (n=604)     | report                                  | public               |
| v4.A-ACC.pair                      | 0.976 · (n=616)     | 0.976 · (n=616)     | 0.984 · (n=616)     | report                                  | public               |
| v4.A1.en-vi                        | 0.985 · (n=5612)    | 0.985 · (n=5612)    | 0.986 · (n=5612)    | report                                  | real                 |
| v4.A1.en-zh                        | 0.989 · (n=4334)    | 0.989 · (n=4334)    | 0.987 · (n=4334)    | report                                  | mixed                |
| v4.A1.vi-zh                        | 0.986 · (n=3492)    | 0.986 · (n=3492)    | 0.986 · (n=3492)    | report                                  | mixed                |
| v4.A2.en-vi                        | 0.952 · (n=2050)    | 0.952 · (n=2050)    | 0.952 · (n=2050)    | report                                  | real+cv              |
| v4.A2.en-vi.edacc                  | 0.995 · (n=1682)    | 0.993 · (n=1682)    | 0.989 · (n=1682)    | report                                  | edacc                |
| v4.A2.en-vi.err_after_fallback     | 0.048 · (n=2050)    | 0.051 · (n=2050)    | 0.054 · (n=2050)    | report                                  | real+cv              |
| v4.A2.en-vi.rerecorded             | 0.929 · (n=56)      | 0.946 · (n=56)      | 0.946 · (n=56)      | report                                  | rerecorded           |
| v4.A2.en-vi.vietmed                | 1.000 · (n=6)       | 0.833 · (n=6)       | 0.833 · (n=6)       | report                                  | vietmed              |
| v4.A2.en-vi.vietmed-cut            | 0.720 · (n=300)     | 0.710 · (n=300)     | 0.710 · (n=300)     | report                                  | vietmed-cut          |
| v4.A2.en-vi.vimedcss               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss             |
| v4.A2.en-zh                        | 0.769 · (n=3314)    | 0.769 · (n=3314)    | 0.769 · (n=3314)    | report                                  | real+cv              |
| v4.A2.en-zh.ascend                 | 0.663 · (n=1982)    | 0.663 · (n=1982)    | 0.663 · (n=1982)    | report                                  | ascend               |
| v4.A2.en-zh.edacc                  | 0.943 · (n=1228)    | 0.940 · (n=1228)    | 0.900 · (n=1228)    | report                                  | edacc                |
| v4.A2.en-zh.err_after_fallback     | 0.231 · (n=3314)    | 0.231 · (n=3314)    | 0.246 · (n=3314)    | report                                  | real+cv              |
| v4.A2.en-zh.rerecorded             | 0.750 · (n=104)     | 0.760 · (n=104)     | 0.760 · (n=104)     | report                                  | rerecorded           |
| v4.A2.vi-zh                        | 0.813 · (n=524)     | 0.813 · (n=524)     | 0.813 · (n=524)     | report                                  | real+cv              |
| v4.A2.vi-zh.ascend                 | 0.987 · (n=152)     | 0.987 · (n=152)     | 0.987 · (n=152)     | report                                  | ascend               |
| v4.A2.vi-zh.err_after_fallback     | 0.187 · (n=524)     | 0.187 · (n=524)     | 0.187 · (n=524)     | report                                  | real+cv              |
| v4.A2.vi-zh.rerecorded             | 0.933 · (n=60)      | 0.917 · (n=60)      | 0.917 · (n=60)      | report                                  | rerecorded           |
| v4.A2.vi-zh.vietmed                | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed              |
| v4.A2.vi-zh.vietmed-cut            | 0.700 · (n=300)     | 0.703 · (n=300)     | 0.703 · (n=300)     | report                                  | vietmed-cut          |
| v4.A2.vi-zh.vimedcss               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss             |
| v4.A3.long.by_lang.en              | 0.979 · (n=1624)    | 0.978 · (n=1624)    | 0.984 · (n=1624)    | report                                  | real                 |
| v4.A3.long.by_lang.vi              | 0.981 · (n=2317)    | 0.981 · (n=2317)    | 0.982 · (n=2317)    | report                                  | real                 |
| v4.A3.long.by_lang.zh              | 0.986 · (n=635)     | 0.986 · (n=635)     | 0.986 · (n=635)     | report                                  | real                 |
| v4.A3.long.vien                    | 0.980 · (n=3941)    | 0.979 · (n=3941)    | 0.983 · (n=3941)    | report                                  | real                 |
| v4.A3.long.zh                      | 0.992 · (n=1135)    | 0.992 · (n=1135)    | 0.992 · (n=1135)    | report                                  | mixed                |
| v4.A3.short.by_lang.en             | 0.929 · (n=1346)    | 0.928 · (n=1346)    | 0.933 · (n=1346)    | report                                  | real                 |
| v4.A3.short.by_lang.en.ascend      | 0.885 · (n=253)     | 0.885 · (n=253)     | 0.885 · (n=253)     | report                                  | ascend               |
| v4.A3.short.by_lang.en.edacc       | 0.938 · (n=1068)    | 0.937 · (n=1068)    | 0.944 · (n=1068)    | report                                  | edacc                |
| v4.A3.short.by_lang.en.rerecorded  | 0.960 · (n=25)      | 0.960 · (n=25)      | 0.960 · (n=25)      | report                                  | rerecorded           |
| v4.A3.short.by_lang.vi             | 0.585 · (n=159)     | 0.585 · (n=159)     | 0.585 · (n=159)     | report                                  | real                 |
| v4.A3.short.by_lang.vi.rerecorded  | 0.000 · (n=3)       | 0.000 · (n=3)       | 0.000 · (n=3)       | report                                  | rerecorded           |
| v4.A3.short.by_lang.vi.vietmed     | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | vietmed              |
| v4.A3.short.by_lang.vi.vietmed-cut | 0.587 · (n=150)     | 0.587 · (n=150)     | 0.587 · (n=150)     | report                                  | vietmed-cut          |
| v4.A3.short.by_lang.vi.vimedcss    | 0.667 · (n=3)       | 0.667 · (n=3)       | 0.667 · (n=3)       | report                                  | vimedcss             |
| v4.A3.short.by_lang.zh             | 0.569 · (n=765)     | 0.569 · (n=765)     | 0.569 · (n=765)     | report                                  | real                 |
| v4.A3.short.by_lang.zh.ascend      | 0.569 · (n=738)     | 0.569 · (n=738)     | 0.569 · (n=738)     | report                                  | ascend               |
| v4.A3.short.by_lang.zh.rerecorded  | 0.556 · (n=27)      | 0.556 · (n=27)      | 0.556 · (n=27)      | report                                  | rerecorded           |
| v4.A3.short.vien                   | 0.892 · (n=1505)    | 0.892 · (n=1505)    | 0.896 · (n=1505)    | report                                  | real                 |
| v4.A3.short.zh                     | 0.569 · (n=765)     | 0.569 · (n=765)     | 0.569 · (n=765)     | report                                  | real                 |
| v4.A4                              | 0.963 · (n=1833)    | 0.963 · (n=1833)    | 0.963 · (n=1833)    | report                                  | real                 |
| v4.A5                              | —                   | —                   | —                   | report                                  | missing silero facts |
| v4.A6.en-vi.changed                | 0.074 · (n=6758)    | 0.073 · (n=6758)    | 0.074 · (n=6758)    | report                                  | real                 |
| v4.A6.en-vi.first_language_p95_ms  | 3096.780 · (n=7662) | 3096.780 · (n=7662) | 3096.780 · (n=7662) | report                                  | real                 |
| v4.A6.en-zh.changed                | 0.010 · (n=6428)    | 0.010 · (n=6428)    | 0.009 · (n=6428)    | report                                  | mixed                |
| v4.A6.en-zh.first_language_p95_ms  | 3090.150 · (n=7648) | 3090.150 · (n=7648) | 3090.590 · (n=7648) | report                                  | mixed                |
| v4.A6.vi-zh.changed                | 0.086 · (n=3952)    | 0.085 · (n=3952)    | 0.085 · (n=3952)    | report                                  | mixed                |
| v4.A6.vi-zh.first_language_p95_ms  | 3086.320 · (n=4016) | 3086.320 · (n=4016) | 3086.320 · (n=4016) | report                                  | mixed                |
| v4.A7                              | 125.710 · (n=29672) | 125.710 · (n=29672) | 125.710 · (n=29672) | report                                  | mixed                |
| v4.A9-mono.en                      | 0.010 · (n=200)     | 0.010 · (n=200)     | 0.000 · (n=200)     | report                                  | real                 |
| v4.A9-mono.vi                      | 0.000 · (n=200)     | 0.000 · (n=200)     | 0.000 · (n=200)     | report                                  | real                 |
| v4.detect2v3.short.en              | -0.062 · (n=1346)   | -0.063 · (n=1346)   | -0.059 · (n=1346)   | report                                  | real                 |
| v4.detect2v3.short.vi              | -0.132 · (n=159)    | -0.132 · (n=159)    | -0.132 · (n=159)    | report                                  | real                 |
| v4.lock.en-vi.accuracy             | 0.897 · (n=5321)    | 0.897 · (n=5321)    | 0.897 · (n=5321)    | report                                  | real                 |
| v4.lock.en-zh.accuracy             | 0.981 · (n=4052)    | 0.981 · (n=4052)    | 0.982 · (n=4040)    | report                                  | mixed                |
| v4.lock.vi-zh.accuracy             | 0.895 · (n=3464)    | 0.895 · (n=3464)    | 0.895 · (n=3464)    | report                                  | mixed                |
| v4.zh_real.A1.en-zh                | 0.986 · (n=1270)    | 0.986 · (n=1270)    | 0.986 · (n=1270)    | report                                  | real                 |
| v4.zh_real.A1.vi-zh                | 1.000 · (n=150)     | 1.000 · (n=150)     | 1.000 · (n=150)     | report                                  | real                 |
| v4.zh_real.A3                      | 0.758 · (n=1400)    | 0.758 · (n=1400)    | 0.758 · (n=1400)    | report                                  | real                 |
| zh_real.A1.en-zh                   | 0.986 · (n=1270)    | 0.986 · (n=1270)    | 0.986 · (n=1270)    | report                                  | real                 |
| zh_real.A1.vi-zh                   | 1.000 · (n=150)     | 1.000 · (n=150)     | 1.000 · (n=150)     | report                                  | real                 |
| zh_real.A3                         | 0.758 · (n=1400)    | 0.758 · (n=1400)    | 0.758 · (n=1400)    | report                                  | real                 |

## arbiter_whisper_gemini (cv None, tau_noise 0.0)

| criterion                          | bare                | src                 | src+voice           | threshold                               | data                 |
| ---------------------------------- | ------------------- | ------------------- | ------------------- | --------------------------------------- | -------------------- |
| A-ACC.detect                       | 0.967 ✓ (n=604)     | 0.964 ✓ (n=604)     | 0.972 ✓ (n=604)     | >=0.95                                  | public               |
| A-ACC.pair                         | 0.976 ✓ (n=616)     | 0.976 ✓ (n=616)     | 0.977 ✓ (n=616)     | >=0.95                                  | public               |
| A1.en-vi                           | 0.988 ✓ (n=5586)    | 0.988 ✓ (n=5586)    | 0.988 ✓ (n=5586)    | >=0.97                                  | real                 |
| A1.en-zh                           | 0.989 ✓ (n=4332)    | 0.989 ✓ (n=4332)    | 0.989 ✓ (n=4332)    | >=0.97                                  | mixed                |
| A1.vi-zh                           | 0.987 ✓ (n=3468)    | 0.987 ✓ (n=3468)    | 0.987 ✓ (n=3468)    | >=0.97                                  | mixed                |
| A2.en-vi                           | 0.936 ✓ (n=1227)    | 0.936 ✓ (n=1227)    | 0.936 ✓ (n=1227)    | >=0.90 raw OR <=0.05 err after fallback | real+cv              |
| A2.en-vi.edacc                     | 0.988 · (n=911)     | 0.988 · (n=911)     | 0.988 · (n=911)     | report                                  | edacc                |
| A2.en-vi.err_after_fallback        | 0.064 ✗ (n=1227)    | 0.064 ✗ (n=1227)    | 0.064 ✗ (n=1227)    | <=0.05                                  | real+cv              |
| A2.en-vi.rerecorded                | 1.000 · (n=24)      | 1.000 · (n=24)      | 1.000 · (n=24)      | report                                  | rerecorded           |
| A2.en-vi.vietmed                   | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed              |
| A2.en-vi.vietmed-cut               | 0.759 · (n=282)     | 0.759 · (n=282)     | 0.759 · (n=282)     | report                                  | vietmed-cut          |
| A2.en-vi.vimedcss                  | 1.000 · (n=4)       | 1.000 · (n=4)       | 1.000 · (n=4)       | report                                  | vimedcss             |
| A2.en-zh                           | 0.863 ✗ (n=2094)    | 0.863 ✗ (n=2094)    | 0.863 ✗ (n=2094)    | >=0.90 raw OR <=0.05 err after fallback | real+cv              |
| A2.en-zh.ascend                    | 0.834 · (n=1374)    | 0.834 · (n=1374)    | 0.834 · (n=1374)    | report                                  | ascend               |
| A2.en-zh.edacc                     | 0.929 · (n=676)     | 0.928 · (n=676)     | 0.928 · (n=676)     | report                                  | edacc                |
| A2.en-zh.err_after_fallback        | 0.137 ✗ (n=2094)    | 0.136 ✗ (n=2094)    | 0.136 ✗ (n=2094)    | <=0.05                                  | real+cv              |
| A2.en-zh.rerecorded                | 0.773 · (n=44)      | 0.841 · (n=44)      | 0.841 · (n=44)      | report                                  | rerecorded           |
| A2.vi-zh                           | 0.832 ✗ (n=440)     | 0.832 ✗ (n=440)     | 0.832 ✗ (n=440)     | >=0.90 raw OR <=0.05 err after fallback | real+cv              |
| A2.vi-zh.ascend                    | 0.983 · (n=116)     | 0.983 · (n=116)     | 0.983 · (n=116)     | report                                  | ascend               |
| A2.vi-zh.err_after_fallback        | 0.168 ✗ (n=440)     | 0.186 ✗ (n=440)     | 0.186 ✗ (n=440)     | <=0.05                                  | real+cv              |
| A2.vi-zh.rerecorded                | 1.000 · (n=32)      | 0.875 · (n=32)      | 0.875 · (n=32)      | report                                  | rerecorded           |
| A2.vi-zh.vietmed                   | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed              |
| A2.vi-zh.vietmed-cut               | 0.745 · (n=282)     | 0.730 · (n=282)     | 0.730 · (n=282)     | report                                  | vietmed-cut          |
| A2.vi-zh.vimedcss                  | 1.000 · (n=4)       | 1.000 · (n=4)       | 1.000 · (n=4)       | report                                  | vimedcss             |
| A3.long.by_lang.en                 | 0.979 · (n=1623)    | 0.978 · (n=1623)    | 0.981 · (n=1623)    | report                                  | real                 |
| A3.long.by_lang.vi                 | 0.985 · (n=2305)    | 0.985 · (n=2305)    | 0.985 · (n=2305)    | report                                  | real                 |
| A3.long.by_lang.zh                 | 0.986 · (n=635)     | 0.986 · (n=635)     | 0.986 · (n=635)     | report                                  | real                 |
| A3.long.vien                       | 0.983 ✓ (n=3928)    | 0.982 ✓ (n=3928)    | 0.983 ✓ (n=3928)    | >=0.95                                  | real                 |
| A3.long.zh                         | 0.992 ✓ (n=1135)    | 0.992 ✓ (n=1135)    | 0.992 ✓ (n=1135)    | >=0.95                                  | mixed                |
| A3.short.by_lang.en                | 0.910 · (n=790)     | 0.915 · (n=790)     | 0.920 · (n=790)     | report                                  | real                 |
| A3.short.by_lang.en.ascend         | 0.885 · (n=208)     | 0.885 · (n=208)     | 0.885 · (n=208)     | report                                  | ascend               |
| A3.short.by_lang.en.edacc          | 0.920 · (n=573)     | 0.927 · (n=573)     | 0.934 · (n=573)     | report                                  | edacc                |
| A3.short.by_lang.en.rerecorded     | 0.889 · (n=9)       | 0.889 · (n=9)       | 0.889 · (n=9)       | report                                  | rerecorded           |
| A3.short.by_lang.vi                | 0.651 · (n=149)     | 0.651 · (n=149)     | 0.651 · (n=149)     | report                                  | real                 |
| A3.short.by_lang.vi.rerecorded     | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | rerecorded           |
| A3.short.by_lang.vi.vietmed        | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | vietmed              |
| A3.short.by_lang.vi.vietmed-cut    | 0.631 · (n=141)     | 0.631 · (n=141)     | 0.631 · (n=141)     | report                                  | vietmed-cut          |
| A3.short.by_lang.vi.vimedcss       | 1.000 · (n=2)       | 1.000 · (n=2)       | 1.000 · (n=2)       | report                                  | vimedcss             |
| A3.short.by_lang.zh                | 0.791 · (n=492)     | 0.791 · (n=492)     | 0.791 · (n=492)     | report                                  | real                 |
| A3.short.by_lang.zh.ascend         | 0.793 · (n=479)     | 0.793 · (n=479)     | 0.793 · (n=479)     | report                                  | ascend               |
| A3.short.by_lang.zh.rerecorded     | 0.692 · (n=13)      | 0.692 · (n=13)      | 0.692 · (n=13)      | report                                  | rerecorded           |
| A3.short.vien                      | 0.869 ✓ (n=939)     | 0.873 ✓ (n=939)     | 0.878 ✓ (n=939)     | >=0.85                                  | real                 |
| A3.short.zh                        | 0.791 ✗ (n=492)     | 0.791 ✗ (n=492)     | 0.791 ✗ (n=492)     | >=0.85                                  | real                 |
| A4                                 | 0.967 ✓ (n=1833)    | 0.967 ✓ (n=1833)    | 0.967 ✓ (n=1833)    | >=0.95                                  | real                 |
| A5                                 | —                   | —                   | —                   | >=0.90 rejected                         | missing silero facts |
| A6.en-vi.changed                   | 0.074 ✓ (n=6618)    | 0.074 ✓ (n=6618)    | 0.074 ✓ (n=6618)    | <=0.10                                  | real                 |
| A6.en-vi.first_language_p95_ms     | 3099.130 ✓ (n=6813) | 3099.130 ✓ (n=6813) | 3099.130 ✓ (n=6813) | <=3500                                  | real                 |
| A6.en-zh.changed                   | 0.010 ✓ (n=6156)    | 0.010 ✓ (n=6156)    | 0.010 ✓ (n=6156)    | <=0.10                                  | mixed                |
| A6.en-zh.first_language_p95_ms     | 3094.475 ✓ (n=6426) | 3094.475 ✓ (n=6426) | 3094.475 ✓ (n=6426) | <=3500                                  | mixed                |
| A6.vi-zh.changed                   | 0.084 ✓ (n=3894)    | 0.083 ✓ (n=3894)    | 0.083 ✓ (n=3894)    | <=0.10                                  | mixed                |
| A6.vi-zh.first_language_p95_ms     | 3086.382 ✓ (n=3908) | 3086.382 ✓ (n=3908) | 3086.382 ✓ (n=3908) | <=3500                                  | mixed                |
| A7                                 | 127.720 ✓ (n=29672) | 127.720 ✓ (n=29672) | 127.720 ✓ (n=29672) | <=150 ms p95                            | mixed                |
| A9-mono.en                         | 0.014 ✓ (n=138)     | 0.014 ✓ (n=138)     | 0.014 ✓ (n=138)     | <=0.03 err (worst source)               | real                 |
| A9-mono.vi                         | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | 0.000 ✓ (n=200)     | <=0.03 err (worst source)               | real                 |
| detect2v3.short.en                 | -0.077 ✗ (n=790)    | -0.072 ✗ (n=790)    | -0.070 ✗ (n=790)    | >=-0.02                                 | real                 |
| detect2v3.short.vi                 | -0.094 ✗ (n=149)    | -0.094 ✗ (n=149)    | -0.094 ✗ (n=149)    | >=-0.02                                 | real                 |
| excluded.en                        | 0.188 · (n=2970)    | 0.188 · (n=2970)    | 0.188 · (n=2970)    | report                                  | real                 |
| excluded.vi                        | 0.009 · (n=2476)    | 0.009 · (n=2476)    | 0.009 · (n=2476)    | report                                  | real                 |
| excluded.zh                        | 0.195 · (n=1400)    | 0.195 · (n=1400)    | 0.195 · (n=1400)    | report                                  | real                 |
| lock.en-vi.accuracy                | 0.900 · (n=5297)    | 0.900 · (n=5297)    | 0.900 · (n=5297)    | report                                  | real                 |
| lock.en-zh.accuracy                | 0.981 · (n=4052)    | 0.981 · (n=4052)    | 0.981 · (n=4052)    | report                                  | mixed                |
| lock.vi-zh.accuracy                | 0.897 · (n=3440)    | 0.897 · (n=3440)    | 0.897 · (n=3440)    | report                                  | mixed                |
| v4.A-ACC.detect                    | 0.967 · (n=604)     | 0.964 · (n=604)     | 0.972 · (n=604)     | report                                  | public               |
| v4.A-ACC.pair                      | 0.976 · (n=616)     | 0.976 · (n=616)     | 0.977 · (n=616)     | report                                  | public               |
| v4.A1.en-vi                        | 0.987 · (n=5612)    | 0.987 · (n=5612)    | 0.987 · (n=5612)    | report                                  | real                 |
| v4.A1.en-zh                        | 0.989 · (n=4334)    | 0.989 · (n=4334)    | 0.989 · (n=4334)    | report                                  | mixed                |
| v4.A1.vi-zh                        | 0.986 · (n=3492)    | 0.986 · (n=3492)    | 0.986 · (n=3492)    | report                                  | mixed                |
| v4.A2.en-vi                        | 0.955 · (n=2050)    | 0.955 · (n=2050)    | 0.955 · (n=2050)    | report                                  | real+cv              |
| v4.A2.en-vi.edacc                  | 0.993 · (n=1682)    | 0.993 · (n=1682)    | 0.993 · (n=1682)    | report                                  | edacc                |
| v4.A2.en-vi.err_after_fallback     | 0.045 · (n=2050)    | 0.045 · (n=2050)    | 0.045 · (n=2050)    | report                                  | real+cv              |
| v4.A2.en-vi.rerecorded             | 1.000 · (n=56)      | 1.000 · (n=56)      | 1.000 · (n=56)      | report                                  | rerecorded           |
| v4.A2.en-vi.vietmed                | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed              |
| v4.A2.en-vi.vietmed-cut            | 0.733 · (n=300)     | 0.733 · (n=300)     | 0.733 · (n=300)     | report                                  | vietmed-cut          |
| v4.A2.en-vi.vimedcss               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss             |
| v4.A2.en-zh                        | 0.770 · (n=3314)    | 0.770 · (n=3314)    | 0.770 · (n=3314)    | report                                  | real+cv              |
| v4.A2.en-zh.ascend                 | 0.664 · (n=1982)    | 0.664 · (n=1982)    | 0.664 · (n=1982)    | report                                  | ascend               |
| v4.A2.en-zh.edacc                  | 0.945 · (n=1228)    | 0.941 · (n=1228)    | 0.941 · (n=1228)    | report                                  | edacc                |
| v4.A2.en-zh.err_after_fallback     | 0.230 · (n=3314)    | 0.231 · (n=3314)    | 0.231 · (n=3314)    | report                                  | real+cv              |
| v4.A2.en-zh.rerecorded             | 0.731 · (n=104)     | 0.731 · (n=104)     | 0.731 · (n=104)     | report                                  | rerecorded           |
| v4.A2.vi-zh                        | 0.828 · (n=524)     | 0.828 · (n=524)     | 0.828 · (n=524)     | report                                  | real+cv              |
| v4.A2.vi-zh.ascend                 | 0.987 · (n=152)     | 0.987 · (n=152)     | 0.987 · (n=152)     | report                                  | ascend               |
| v4.A2.vi-zh.err_after_fallback     | 0.172 · (n=524)     | 0.185 · (n=524)     | 0.185 · (n=524)     | report                                  | real+cv              |
| v4.A2.vi-zh.rerecorded             | 1.000 · (n=60)      | 0.917 · (n=60)      | 0.917 · (n=60)      | report                                  | rerecorded           |
| v4.A2.vi-zh.vietmed                | 1.000 · (n=6)       | 1.000 · (n=6)       | 1.000 · (n=6)       | report                                  | vietmed              |
| v4.A2.vi-zh.vietmed-cut            | 0.713 · (n=300)     | 0.707 · (n=300)     | 0.707 · (n=300)     | report                                  | vietmed-cut          |
| v4.A2.vi-zh.vimedcss               | 0.667 · (n=6)       | 0.667 · (n=6)       | 0.667 · (n=6)       | report                                  | vimedcss             |
| v4.A3.long.by_lang.en              | 0.979 · (n=1624)    | 0.978 · (n=1624)    | 0.981 · (n=1624)    | report                                  | real                 |
| v4.A3.long.by_lang.vi              | 0.984 · (n=2317)    | 0.984 · (n=2317)    | 0.984 · (n=2317)    | report                                  | real                 |
| v4.A3.long.by_lang.zh              | 0.986 · (n=635)     | 0.986 · (n=635)     | 0.986 · (n=635)     | report                                  | real                 |
| v4.A3.long.vien                    | 0.982 · (n=3941)    | 0.981 · (n=3941)    | 0.983 · (n=3941)    | report                                  | real                 |
| v4.A3.long.zh                      | 0.992 · (n=1135)    | 0.992 · (n=1135)    | 0.992 · (n=1135)    | report                                  | mixed                |
| v4.A3.short.by_lang.en             | 0.928 · (n=1346)    | 0.930 · (n=1346)    | 0.935 · (n=1346)    | report                                  | real                 |
| v4.A3.short.by_lang.en.ascend      | 0.893 · (n=253)     | 0.893 · (n=253)     | 0.893 · (n=253)     | report                                  | ascend               |
| v4.A3.short.by_lang.en.edacc       | 0.935 · (n=1068)    | 0.938 · (n=1068)    | 0.944 · (n=1068)    | report                                  | edacc                |
| v4.A3.short.by_lang.en.rerecorded  | 0.960 · (n=25)      | 0.960 · (n=25)      | 0.960 · (n=25)      | report                                  | rerecorded           |
| v4.A3.short.by_lang.vi             | 0.623 · (n=159)     | 0.623 · (n=159)     | 0.623 · (n=159)     | report                                  | real                 |
| v4.A3.short.by_lang.vi.rerecorded  | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | rerecorded           |
| v4.A3.short.by_lang.vi.vietmed     | 1.000 · (n=3)       | 1.000 · (n=3)       | 1.000 · (n=3)       | report                                  | vietmed              |
| v4.A3.short.by_lang.vi.vietmed-cut | 0.607 · (n=150)     | 0.607 · (n=150)     | 0.607 · (n=150)     | report                                  | vietmed-cut          |
| v4.A3.short.by_lang.vi.vimedcss    | 0.667 · (n=3)       | 0.667 · (n=3)       | 0.667 · (n=3)       | report                                  | vimedcss             |
| v4.A3.short.by_lang.zh             | 0.570 · (n=765)     | 0.570 · (n=765)     | 0.570 · (n=765)     | report                                  | real                 |
| v4.A3.short.by_lang.zh.ascend      | 0.572 · (n=738)     | 0.572 · (n=738)     | 0.572 · (n=738)     | report                                  | ascend               |
| v4.A3.short.by_lang.zh.rerecorded  | 0.519 · (n=27)      | 0.519 · (n=27)      | 0.519 · (n=27)      | report                                  | rerecorded           |
| v4.A3.short.vien                   | 0.896 · (n=1505)    | 0.898 · (n=1505)    | 0.902 · (n=1505)    | report                                  | real                 |
| v4.A3.short.zh                     | 0.570 · (n=765)     | 0.570 · (n=765)     | 0.570 · (n=765)     | report                                  | real                 |
| v4.A4                              | 0.967 · (n=1833)    | 0.967 · (n=1833)    | 0.967 · (n=1833)    | report                                  | real                 |
| v4.A5                              | —                   | —                   | —                   | report                                  | missing silero facts |
| v4.A6.en-vi.changed                | 0.073 · (n=6758)    | 0.073 · (n=6758)    | 0.073 · (n=6758)    | report                                  | real                 |
| v4.A6.en-vi.first_language_p95_ms  | 3096.780 · (n=7662) | 3096.780 · (n=7662) | 3096.780 · (n=7662) | report                                  | real                 |
| v4.A6.en-zh.changed                | 0.010 · (n=6428)    | 0.010 · (n=6428)    | 0.010 · (n=6428)    | report                                  | mixed                |
| v4.A6.en-zh.first_language_p95_ms  | 3090.150 · (n=7648) | 3090.150 · (n=7648) | 3090.150 · (n=7648) | report                                  | mixed                |
| v4.A6.vi-zh.changed                | 0.085 · (n=3952)    | 0.084 · (n=3952)    | 0.084 · (n=3952)    | report                                  | mixed                |
| v4.A6.vi-zh.first_language_p95_ms  | 3086.320 · (n=4016) | 3086.320 · (n=4016) | 3086.320 · (n=4016) | report                                  | mixed                |
| v4.A7                              | 127.720 · (n=29672) | 127.720 · (n=29672) | 127.720 · (n=29672) | report                                  | mixed                |
| v4.A9-mono.en                      | 0.010 · (n=200)     | 0.010 · (n=200)     | 0.010 · (n=200)     | report                                  | real                 |
| v4.A9-mono.vi                      | 0.000 · (n=200)     | 0.000 · (n=200)     | 0.000 · (n=200)     | report                                  | real                 |
| v4.detect2v3.short.en              | -0.063 · (n=1346)   | -0.061 · (n=1346)   | -0.058 · (n=1346)   | report                                  | real                 |
| v4.detect2v3.short.vi              | -0.094 · (n=159)    | -0.094 · (n=159)    | -0.094 · (n=159)    | report                                  | real                 |
| v4.lock.en-vi.accuracy             | 0.897 · (n=5321)    | 0.897 · (n=5321)    | 0.897 · (n=5321)    | report                                  | real                 |
| v4.lock.en-zh.accuracy             | 0.981 · (n=4052)    | 0.981 · (n=4052)    | 0.981 · (n=4052)    | report                                  | mixed                |
| v4.lock.vi-zh.accuracy             | 0.895 · (n=3464)    | 0.895 · (n=3464)    | 0.895 · (n=3464)    | report                                  | mixed                |
| v4.zh_real.A1.en-zh                | 0.986 · (n=1270)    | 0.986 · (n=1270)    | 0.986 · (n=1270)    | report                                  | real                 |
| v4.zh_real.A1.vi-zh                | 1.000 · (n=150)     | 1.000 · (n=150)     | 1.000 · (n=150)     | report                                  | real                 |
| v4.zh_real.A3                      | 0.759 · (n=1400)    | 0.759 · (n=1400)    | 0.759 · (n=1400)    | report                                  | real                 |
| zh_real.A1.en-zh                   | 0.986 · (n=1270)    | 0.986 · (n=1270)    | 0.986 · (n=1270)    | report                                  | real                 |
| zh_real.A1.vi-zh                   | 1.000 · (n=150)     | 1.000 · (n=150)     | 1.000 · (n=150)     | report                                  | real                 |
| zh_real.A3                         | 0.759 · (n=1400)    | 0.759 · (n=1400)    | 0.759 · (n=1400)    | report                                  | real                 |

## gemini_decision (cv None, tau_noise 0.0)

| criterion                          | bare                 | src                  | src+voice            | threshold                               | data                 |
| ---------------------------------- | -------------------- | -------------------- | -------------------- | --------------------------------------- | -------------------- |
| A-ACC.detect                       | 0.811 ✗ (n=604)      | 0.811 ✗ (n=604)      | 0.811 ✗ (n=604)      | >=0.95                                  | public               |
| A-ACC.pair                         | 0.854 ✗ (n=616)      | 0.854 ✗ (n=616)      | 0.854 ✗ (n=616)      | >=0.95                                  | public               |
| A1.en-vi                           | 0.973 ✓ (n=5586)     | 0.972 ✓ (n=5586)     | 0.973 ✓ (n=5586)     | >=0.97                                  | real                 |
| A1.en-zh                           | 0.965 ✗ (n=4332)     | 0.964 ✗ (n=4332)     | 0.965 ✗ (n=4332)     | >=0.97                                  | mixed                |
| A1.vi-zh                           | 0.967 ✗ (n=3468)     | 0.967 ✗ (n=3468)     | 0.967 ✗ (n=3468)     | >=0.97                                  | mixed                |
| A2.en-vi                           | 0.898 ✗ (n=1227)     | 0.898 ✗ (n=1227)     | 0.898 ✗ (n=1227)     | >=0.90 raw OR <=0.05 err after fallback | real+cv              |
| A2.en-vi.edacc                     | 0.878 · (n=911)      | 0.847 · (n=911)      | 0.878 · (n=911)      | report                                  | edacc                |
| A2.en-vi.err_after_fallback        | 0.102 ✗ (n=1227)     | 0.125 ✗ (n=1227)     | 0.102 ✗ (n=1227)     | <=0.05                                  | real+cv              |
| A2.en-vi.rerecorded                | 0.917 · (n=24)       | 0.917 · (n=24)       | 0.917 · (n=24)       | report                                  | rerecorded           |
| A2.en-vi.vietmed                   | 1.000 · (n=6)        | 1.000 · (n=6)        | 1.000 · (n=6)        | report                                  | vietmed              |
| A2.en-vi.vietmed-cut               | 0.957 · (n=282)      | 0.957 · (n=282)      | 0.957 · (n=282)      | report                                  | vietmed-cut          |
| A2.en-vi.vimedcss                  | 1.000 · (n=4)        | 1.000 · (n=4)        | 1.000 · (n=4)        | report                                  | vimedcss             |
| A2.en-zh                           | 0.828 ✗ (n=2094)     | 0.828 ✗ (n=2094)     | 0.828 ✗ (n=2094)     | >=0.90 raw OR <=0.05 err after fallback | real+cv              |
| A2.en-zh.ascend                    | 0.856 · (n=1374)     | 0.856 · (n=1374)     | 0.856 · (n=1374)     | report                                  | ascend               |
| A2.en-zh.edacc                     | 0.775 · (n=676)      | 0.712 · (n=676)      | 0.775 · (n=676)      | report                                  | edacc                |
| A2.en-zh.err_after_fallback        | 0.172 ✗ (n=2094)     | 0.192 ✗ (n=2094)     | 0.172 ✗ (n=2094)     | <=0.05                                  | real+cv              |
| A2.en-zh.rerecorded                | 0.773 · (n=44)       | 0.773 · (n=44)       | 0.773 · (n=44)       | report                                  | rerecorded           |
| A2.vi-zh                           | 0.736 ✗ (n=440)      | 0.736 ✗ (n=440)      | 0.736 ✗ (n=440)      | >=0.90 raw OR <=0.05 err after fallback | real+cv              |
| A2.vi-zh.ascend                    | 0.966 · (n=116)      | 0.966 · (n=116)      | 0.966 · (n=116)      | report                                  | ascend               |
| A2.vi-zh.err_after_fallback        | 0.264 ✗ (n=440)      | 0.264 ✗ (n=440)      | 0.264 ✗ (n=440)      | <=0.05                                  | real+cv              |
| A2.vi-zh.rerecorded                | 0.875 · (n=32)       | 0.875 · (n=32)       | 0.875 · (n=32)       | report                                  | rerecorded           |
| A2.vi-zh.vietmed                   | 1.000 · (n=6)        | 1.000 · (n=6)        | 1.000 · (n=6)        | report                                  | vietmed              |
| A2.vi-zh.vietmed-cut               | 0.617 · (n=282)      | 0.617 · (n=282)      | 0.617 · (n=282)      | report                                  | vietmed-cut          |
| A2.vi-zh.vimedcss                  | 1.000 · (n=4)        | 1.000 · (n=4)        | 1.000 · (n=4)        | report                                  | vimedcss             |
| A3.long.by_lang.en                 | 0.883 · (n=1623)     | 0.884 · (n=1623)     | 0.883 · (n=1623)     | report                                  | real                 |
| A3.long.by_lang.vi                 | 0.940 · (n=2305)     | 0.940 · (n=2305)     | 0.940 · (n=2305)     | report                                  | real                 |
| A3.long.by_lang.zh                 | 1.000 · (n=635)      | 1.000 · (n=635)      | 1.000 · (n=635)      | report                                  | real                 |
| A3.long.vien                       | 0.916 ✗ (n=3928)     | 0.917 ✗ (n=3928)     | 0.916 ✗ (n=3928)     | >=0.95                                  | real                 |
| A3.long.zh                         | 1.000 ✓ (n=1135)     | 1.000 ✓ (n=1135)     | 1.000 ✓ (n=1135)     | >=0.95                                  | mixed                |
| A3.short.by_lang.en                | 0.633 · (n=790)      | 0.638 · (n=790)      | 0.633 · (n=790)      | report                                  | real                 |
| A3.short.by_lang.en.ascend         | 0.596 · (n=208)      | 0.596 · (n=208)      | 0.596 · (n=208)      | report                                  | ascend               |
| A3.short.by_lang.en.edacc          | 0.644 · (n=573)      | 0.651 · (n=573)      | 0.644 · (n=573)      | report                                  | edacc                |
| A3.short.by_lang.en.rerecorded     | 0.778 · (n=9)        | 0.778 · (n=9)        | 0.778 · (n=9)        | report                                  | rerecorded           |
| A3.short.by_lang.vi                | 0.638 · (n=149)      | 0.638 · (n=149)      | 0.638 · (n=149)      | report                                  | real                 |
| A3.short.by_lang.vi.rerecorded     | 1.000 · (n=3)        | 1.000 · (n=3)        | 1.000 · (n=3)        | report                                  | rerecorded           |
| A3.short.by_lang.vi.vietmed        | 1.000 · (n=3)        | 1.000 · (n=3)        | 1.000 · (n=3)        | report                                  | vietmed              |
| A3.short.by_lang.vi.vietmed-cut    | 0.617 · (n=141)      | 0.617 · (n=141)      | 0.617 · (n=141)      | report                                  | vietmed-cut          |
| A3.short.by_lang.vi.vimedcss       | 1.000 · (n=2)        | 1.000 · (n=2)        | 1.000 · (n=2)        | report                                  | vimedcss             |
| A3.short.by_lang.zh                | 0.941 · (n=492)      | 0.941 · (n=492)      | 0.941 · (n=492)      | report                                  | real                 |
| A3.short.by_lang.zh.ascend         | 0.948 · (n=479)      | 0.948 · (n=479)      | 0.948 · (n=479)      | report                                  | ascend               |
| A3.short.by_lang.zh.rerecorded     | 0.692 · (n=13)       | 0.692 · (n=13)       | 0.692 · (n=13)       | report                                  | rerecorded           |
| A3.short.vien                      | 0.634 ✗ (n=939)      | 0.638 ✗ (n=939)      | 0.634 ✗ (n=939)      | >=0.85                                  | real                 |
| A3.short.zh                        | 0.941 ✓ (n=492)      | 0.941 ✓ (n=492)      | 0.941 ✓ (n=492)      | >=0.85                                  | real                 |
| A4                                 | 0.958 ✓ (n=1833)     | 0.958 ✓ (n=1833)     | 0.958 ✓ (n=1833)     | >=0.95                                  | real                 |
| A5                                 | —                    | —                    | —                    | >=0.90 rejected                         | missing silero facts |
| A6.en-vi.changed                   | —                    | —                    | —                    | <=0.10                                  | real                 |
| A6.en-vi.first_language_p95_ms     | 8260.000 ✗ (n=6813)  | 8260.000 ✗ (n=6813)  | 8260.000 ✗ (n=6813)  | <=3500                                  | real                 |
| A6.en-zh.changed                   | —                    | —                    | —                    | <=0.10                                  | mixed                |
| A6.en-zh.first_language_p95_ms     | 7700.000 ✗ (n=6426)  | 7700.000 ✗ (n=6426)  | 7700.000 ✗ (n=6426)  | <=3500                                  | mixed                |
| A6.vi-zh.changed                   | —                    | —                    | —                    | <=0.10                                  | mixed                |
| A6.vi-zh.first_language_p95_ms     | 8320.000 ✗ (n=3908)  | 8320.000 ✗ (n=3908)  | 8320.000 ✗ (n=3908)  | <=3500                                  | mixed                |
| A7                                 | 1210.554 ✗ (n=29672) | 1210.554 ✗ (n=29672) | 1210.554 ✗ (n=29672) | <=150 ms p95                            | mixed                |
| A9-mono.en                         | 0.029 ✓ (n=138)      | 0.000 ✓ (n=138)      | 0.029 ✓ (n=138)      | <=0.03 err (worst source)               | real                 |
| A9-mono.vi                         | 0.000 ✓ (n=200)      | 0.000 ✓ (n=200)      | 0.000 ✓ (n=200)      | <=0.03 err (worst source)               | real                 |
| detect2v3.short.en                 | -0.354 ✗ (n=790)     | -0.349 ✗ (n=790)     | -0.357 ✗ (n=790)     | >=-0.02                                 | real                 |
| detect2v3.short.vi                 | -0.107 ✗ (n=149)     | -0.107 ✗ (n=149)     | -0.107 ✗ (n=149)     | >=-0.02                                 | real                 |
| excluded.en                        | 0.188 · (n=2970)     | 0.188 · (n=2970)     | 0.188 · (n=2970)     | report                                  | real                 |
| excluded.vi                        | 0.009 · (n=2476)     | 0.009 · (n=2476)     | 0.009 · (n=2476)     | report                                  | real                 |
| excluded.zh                        | 0.195 · (n=1400)     | 0.195 · (n=1400)     | 0.195 · (n=1400)     | report                                  | real                 |
| lock.en-vi.accuracy                | —                    | —                    | —                    | report                                  | real                 |
| lock.en-zh.accuracy                | —                    | —                    | —                    | report                                  | mixed                |
| lock.vi-zh.accuracy                | —                    | —                    | —                    | report                                  | mixed                |
| v4.A-ACC.detect                    | 0.811 · (n=604)      | 0.811 · (n=604)      | 0.811 · (n=604)      | report                                  | public               |
| v4.A-ACC.pair                      | 0.854 · (n=616)      | 0.854 · (n=616)      | 0.854 · (n=616)      | report                                  | public               |
| v4.A1.en-vi                        | 0.973 · (n=5612)     | 0.971 · (n=5612)     | 0.973 · (n=5612)     | report                                  | real                 |
| v4.A1.en-zh                        | 0.965 · (n=4334)     | 0.963 · (n=4334)     | 0.965 · (n=4334)     | report                                  | mixed                |
| v4.A1.vi-zh                        | 0.967 · (n=3492)     | 0.967 · (n=3492)     | 0.967 · (n=3492)     | report                                  | mixed                |
| v4.A2.en-vi                        | 0.911 · (n=2050)     | 0.911 · (n=2050)     | 0.911 · (n=2050)     | report                                  | real+cv              |
| v4.A2.en-vi.edacc                  | 0.903 · (n=1682)     | 0.860 · (n=1682)     | 0.903 · (n=1682)     | report                                  | edacc                |
| v4.A2.en-vi.err_after_fallback     | 0.089 · (n=2050)     | 0.124 · (n=2050)     | 0.089 · (n=2050)     | report                                  | real+cv              |
| v4.A2.en-vi.rerecorded             | 0.929 · (n=56)       | 0.929 · (n=56)       | 0.929 · (n=56)       | report                                  | rerecorded           |
| v4.A2.en-vi.vietmed                | 1.000 · (n=6)        | 1.000 · (n=6)        | 1.000 · (n=6)        | report                                  | vietmed              |
| v4.A2.en-vi.vietmed-cut            | 0.953 · (n=300)      | 0.953 · (n=300)      | 0.953 · (n=300)      | report                                  | vietmed-cut          |
| v4.A2.en-vi.vimedcss               | 0.667 · (n=6)        | 0.667 · (n=6)        | 0.667 · (n=6)        | report                                  | vimedcss             |
| v4.A2.en-zh                        | 0.777 · (n=3314)     | 0.777 · (n=3314)     | 0.777 · (n=3314)     | report                                  | real+cv              |
| v4.A2.en-zh.ascend                 | 0.808 · (n=1982)     | 0.808 · (n=1982)     | 0.808 · (n=1982)     | report                                  | ascend               |
| v4.A2.en-zh.edacc                  | 0.738 · (n=1228)     | 0.634 · (n=1228)     | 0.738 · (n=1228)     | report                                  | edacc                |
| v4.A2.en-zh.err_after_fallback     | 0.223 · (n=3314)     | 0.261 · (n=3314)     | 0.223 · (n=3314)     | report                                  | real+cv              |
| v4.A2.en-zh.rerecorded             | 0.654 · (n=104)      | 0.654 · (n=104)      | 0.654 · (n=104)      | report                                  | rerecorded           |
| v4.A2.vi-zh                        | 0.760 · (n=524)      | 0.760 · (n=524)      | 0.760 · (n=524)      | report                                  | real+cv              |
| v4.A2.vi-zh.ascend                 | 0.974 · (n=152)      | 0.974 · (n=152)      | 0.974 · (n=152)      | report                                  | ascend               |
| v4.A2.vi-zh.err_after_fallback     | 0.240 · (n=524)      | 0.240 · (n=524)      | 0.240 · (n=524)      | report                                  | real+cv              |
| v4.A2.vi-zh.rerecorded             | 0.933 · (n=60)       | 0.933 · (n=60)       | 0.933 · (n=60)       | report                                  | rerecorded           |
| v4.A2.vi-zh.vietmed                | 1.000 · (n=6)        | 1.000 · (n=6)        | 1.000 · (n=6)        | report                                  | vietmed              |
| v4.A2.vi-zh.vietmed-cut            | 0.613 · (n=300)      | 0.613 · (n=300)      | 0.613 · (n=300)      | report                                  | vietmed-cut          |
| v4.A2.vi-zh.vimedcss               | 0.667 · (n=6)        | 0.667 · (n=6)        | 0.667 · (n=6)        | report                                  | vimedcss             |
| v4.A3.long.by_lang.en              | 0.882 · (n=1624)     | 0.884 · (n=1624)     | 0.882 · (n=1624)     | report                                  | real                 |
| v4.A3.long.by_lang.vi              | 0.940 · (n=2317)     | 0.940 · (n=2317)     | 0.940 · (n=2317)     | report                                  | real                 |
| v4.A3.long.by_lang.zh              | 1.000 · (n=635)      | 1.000 · (n=635)      | 1.000 · (n=635)      | report                                  | real                 |
| v4.A3.long.vien                    | 0.916 · (n=3941)     | 0.917 · (n=3941)     | 0.916 · (n=3941)     | report                                  | real                 |
| v4.A3.long.zh                      | 1.000 · (n=1135)     | 1.000 · (n=1135)     | 1.000 · (n=1135)     | report                                  | mixed                |
| v4.A3.short.by_lang.en             | 0.617 · (n=1346)     | 0.626 · (n=1346)     | 0.617 · (n=1346)     | report                                  | real                 |
| v4.A3.short.by_lang.en.ascend      | 0.593 · (n=253)      | 0.593 · (n=253)      | 0.593 · (n=253)      | report                                  | ascend               |
| v4.A3.short.by_lang.en.edacc       | 0.622 · (n=1068)     | 0.633 · (n=1068)     | 0.622 · (n=1068)     | report                                  | edacc                |
| v4.A3.short.by_lang.en.rerecorded  | 0.680 · (n=25)       | 0.680 · (n=25)       | 0.680 · (n=25)       | report                                  | rerecorded           |
| v4.A3.short.by_lang.vi             | 0.629 · (n=159)      | 0.629 · (n=159)      | 0.629 · (n=159)      | report                                  | real                 |
| v4.A3.short.by_lang.vi.rerecorded  | 1.000 · (n=3)        | 1.000 · (n=3)        | 1.000 · (n=3)        | report                                  | rerecorded           |
| v4.A3.short.by_lang.vi.vietmed     | 1.000 · (n=3)        | 1.000 · (n=3)        | 1.000 · (n=3)        | report                                  | vietmed              |
| v4.A3.short.by_lang.vi.vietmed-cut | 0.613 · (n=150)      | 0.613 · (n=150)      | 0.613 · (n=150)      | report                                  | vietmed-cut          |
| v4.A3.short.by_lang.vi.vimedcss    | 0.667 · (n=3)        | 0.667 · (n=3)        | 0.667 · (n=3)        | report                                  | vimedcss             |
| v4.A3.short.by_lang.zh             | 0.854 · (n=765)      | 0.854 · (n=765)      | 0.854 · (n=765)      | report                                  | real                 |
| v4.A3.short.by_lang.zh.ascend      | 0.863 · (n=738)      | 0.863 · (n=738)      | 0.863 · (n=738)      | report                                  | ascend               |
| v4.A3.short.by_lang.zh.rerecorded  | 0.593 · (n=27)       | 0.593 · (n=27)       | 0.593 · (n=27)       | report                                  | rerecorded           |
| v4.A3.short.vien                   | 0.619 · (n=1505)     | 0.627 · (n=1505)     | 0.619 · (n=1505)     | report                                  | real                 |
| v4.A3.short.zh                     | 0.854 · (n=765)      | 0.854 · (n=765)      | 0.854 · (n=765)      | report                                  | real                 |
| v4.A4                              | 0.958 · (n=1833)     | 0.958 · (n=1833)     | 0.958 · (n=1833)     | report                                  | real                 |
| v4.A5                              | —                    | —                    | —                    | report                                  | missing silero facts |
| v4.A6.en-vi.changed                | —                    | —                    | —                    | report                                  | real                 |
| v4.A6.en-vi.first_language_p95_ms  | 8240.000 · (n=7662)  | 8240.000 · (n=7662)  | 8240.000 · (n=7662)  | report                                  | real                 |
| v4.A6.en-zh.changed                | —                    | —                    | —                    | report                                  | mixed                |
| v4.A6.en-zh.first_language_p95_ms  | 7560.000 · (n=7648)  | 7560.000 · (n=7648)  | 7560.000 · (n=7648)  | report                                  | mixed                |
| v4.A6.vi-zh.changed                | —                    | —                    | —                    | report                                  | mixed                |
| v4.A6.vi-zh.first_language_p95_ms  | 8320.000 · (n=4016)  | 8320.000 · (n=4016)  | 8320.000 · (n=4016)  | report                                  | mixed                |
| v4.A7                              | 1210.554 · (n=29672) | 1210.554 · (n=29672) | 1210.554 · (n=29672) | report                                  | mixed                |
| v4.A9-mono.en                      | 0.030 · (n=200)      | 0.000 · (n=200)      | 0.030 · (n=200)      | report                                  | real                 |
| v4.A9-mono.vi                      | 0.000 · (n=200)      | 0.000 · (n=200)      | 0.000 · (n=200)      | report                                  | real                 |
| v4.detect2v3.short.en              | -0.374 · (n=1346)    | -0.365 · (n=1346)    | -0.375 · (n=1346)    | report                                  | real                 |
| v4.detect2v3.short.vi              | -0.088 · (n=159)     | -0.088 · (n=159)     | -0.088 · (n=159)     | report                                  | real                 |
| v4.lock.en-vi.accuracy             | —                    | —                    | —                    | report                                  | real                 |
| v4.lock.en-zh.accuracy             | —                    | —                    | —                    | report                                  | mixed                |
| v4.lock.vi-zh.accuracy             | —                    | —                    | —                    | report                                  | mixed                |
| v4.zh_real.A1.en-zh                | 1.000 · (n=1270)     | 1.000 · (n=1270)     | 1.000 · (n=1270)     | report                                  | real                 |
| v4.zh_real.A1.vi-zh                | 1.000 · (n=150)      | 1.000 · (n=150)      | 1.000 · (n=150)      | report                                  | real                 |
| v4.zh_real.A3                      | 0.920 · (n=1400)     | 0.920 · (n=1400)     | 0.920 · (n=1400)     | report                                  | real                 |
| zh_real.A1.en-zh                   | 1.000 · (n=1270)     | 1.000 · (n=1270)     | 1.000 · (n=1270)     | report                                  | real                 |
| zh_real.A1.vi-zh                   | 1.000 · (n=150)      | 1.000 · (n=150)      | 1.000 · (n=150)      | report                                  | real                 |
| zh_real.A3                         | 0.920 · (n=1400)     | 0.920 · (n=1400)     | 0.920 · (n=1400)     | report                                  | real                 |
