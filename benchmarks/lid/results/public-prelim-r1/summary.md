# LID bake-off `public-prelim-r1`

Outcome: **INCOMPLETE**

## recognizer_competition (cv kfold5, tau_noise 0.0)

| criterion                      | bare               | src                | src+voice          | threshold                               | data              |
| ------------------------------ | ------------------ | ------------------ | ------------------ | --------------------------------------- | ----------------- |
| A-ACC.detect                   | —                  | —                  | —                  | >=0.95                                  | public            |
| A-ACC.pair                     | —                  | —                  | —                  | >=0.95                                  | public            |
| A1.en-vi                       | 1.000 ✓ (n=1198)   | 1.000 ✓ (n=1198)   | 1.000 ✓ (n=1198)   | >=0.97                                  | public-substitute |
| A1.en-zh                       | 1.000 ✓ (n=1594)   | 1.000 ✓ (n=1594)   | 1.000 ✓ (n=1594)   | >=0.97                                  | public-substitute |
| A1.vi-zh                       | 0.996 ✓ (n=1596)   | 0.996 ✓ (n=1596)   | 0.996 ✓ (n=1596)   | >=0.97                                  | public-substitute |
| A2.en-vi                       | 0.000 ✗ (n=2)      | 0.000 ✗ (n=2)      | 0.000 ✗ (n=2)      | >=0.90 raw OR <=0.05 err after fallback | public-substitute |
| A2.en-vi.cv                    | —                  | —                  | —                  | report                                  | cv                |
| A2.en-vi.err_after_fallback    | 1.000 ✗ (n=2)      | 1.000 ✗ (n=2)      | 1.000 ✗ (n=2)      | <=0.05                                  | public-substitute |
| A2.en-vi.real                  | —                  | —                  | —                  | report                                  | real              |
| A2.en-zh                       | 1.000 ✓ (n=6)      | 1.000 ✓ (n=6)      | 1.000 ✓ (n=6)      | >=0.90 raw OR <=0.05 err after fallback | public-substitute |
| A2.en-zh.cv                    | —                  | —                  | —                  | report                                  | cv                |
| A2.en-zh.err_after_fallback    | 0.000 ✓ (n=6)      | 0.000 ✓ (n=6)      | 0.000 ✓ (n=6)      | <=0.05                                  | public-substitute |
| A2.en-zh.real                  | —                  | —                  | —                  | report                                  | real              |
| A2.vi-zh                       | 1.000 ✓ (n=4)      | 1.000 ✓ (n=4)      | 1.000 ✓ (n=4)      | >=0.90 raw OR <=0.05 err after fallback | public-substitute |
| A2.vi-zh.cv                    | —                  | —                  | —                  | report                                  | cv                |
| A2.vi-zh.err_after_fallback    | 0.000 ✓ (n=4)      | 0.000 ✓ (n=4)      | 0.000 ✓ (n=4)      | <=0.05                                  | public-substitute |
| A2.vi-zh.real                  | —                  | —                  | —                  | report                                  | real              |
| A3.long.vien                   | 0.998 ✓ (n=599)    | 0.998 ✓ (n=599)    | 0.998 ✓ (n=599)    | >=0.95                                  | public-substitute |
| A3.long.zh                     | 0.998 ✓ (n=498)    | 0.998 ✓ (n=498)    | 0.998 ✓ (n=498)    | >=0.95                                  | public            |
| A3.short.vien                  | 1.000 ✓ (n=1)      | 1.000 ✓ (n=1)      | 1.000 ✓ (n=1)      | >=0.85                                  | public-substitute |
| A3.short.zh                    | 1.000 ✓ (n=2)      | 1.000 ✓ (n=2)      | 1.000 ✓ (n=2)      | >=0.85                                  | public            |
| A4                             | —                  | —                  | —                  | >=0.95                                  | public-substitute |
| A5                             | 0.900 ✓ (n=80)     | 0.900 ✓ (n=80)     | 0.900 ✓ (n=80)     | >=0.90 rejected                         | esc50             |
| A5.esc50                       | 0.900 · (n=80)     | 0.900 · (n=80)     | 0.900 · (n=80)     | report                                  | esc50             |
| A6.en-vi.changed               | 0.437 ✗ (n=1200)   | 0.437 ✗ (n=1200)   | 0.437 ✗ (n=1200)   | <=0.10                                  | public-substitute |
| A6.en-vi.first_language_p95_ms | 796.031 ✓ (n=1200) | 796.031 ✓ (n=1200) | 796.031 ✓ (n=1200) | <=1000                                  | public-substitute |
| A6.en-zh.changed               | 0.295 ✗ (n=1600)   | 0.295 ✗ (n=1600)   | 0.295 ✗ (n=1600)   | <=0.10                                  | public-substitute |
| A6.en-zh.first_language_p95_ms | 790.526 ✓ (n=1600) | 790.526 ✓ (n=1600) | 790.526 ✓ (n=1600) | <=1000                                  | public-substitute |
| A6.vi-zh.changed               | 0.341 ✗ (n=1600)   | 0.341 ✗ (n=1600)   | 0.341 ✗ (n=1600)   | <=0.10                                  | public-substitute |
| A6.vi-zh.first_language_p95_ms | 690.242 ✓ (n=1600) | 690.242 ✓ (n=1600) | 690.242 ✓ (n=1600) | <=1000                                  | public-substitute |
| A7                             | 269.950 ✗ (n=5500) | 269.950 ✗ (n=5500) | 269.950 ✗ (n=5500) | <=150 ms p95                            | mixed             |
| A9-mono.en                     | —                  | —                  | —                  | <=0.03 err (worst source)               | real              |
| A9-mono.vi                     | —                  | —                  | —                  | <=0.03 err (worst source)               | real              |
| lock.en-vi.accuracy            | 0.562 · (n=1200)   | 0.562 · (n=1200)   | 0.562 · (n=1200)   | report                                  | public-substitute |
| lock.en-zh.accuracy            | 0.705 · (n=1600)   | 0.705 · (n=1600)   | 0.705 · (n=1600)   | report                                  | public-substitute |
| lock.vi-zh.accuracy            | 0.660 · (n=1600)   | 0.660 · (n=1600)   | 0.660 · (n=1600)   | report                                  | public-substitute |
| zh_real.A1.en-zh               | —                  | —                  | —                  | report                                  | real              |
| zh_real.A1.vi-zh               | —                  | —                  | —                  | report                                  | real              |
| zh_real.A3                     | —                  | —                  | —                  | report                                  | real              |
