# LID bake-off `public-prelim-r2`

Outcome: **INCOMPLETE**

## recognizer_competition (cv kfold5, tau_noise 0.0)

| criterion                      | bare               | src                | src+voice          | threshold                 | data              |
| ------------------------------ | ------------------ | ------------------ | ------------------ | ------------------------- | ----------------- |
| A-ACC.detect                   | —                  | —                  | —                  | >=0.95                    | public            |
| A-ACC.pair                     | —                  | —                  | —                  | >=0.95                    | public            |
| A1.en-vi                       | 0.998 ✓ (n=1200)   | 0.998 ✓ (n=1200)   | 0.998 ✓ (n=1200)   | >=0.97                    | public-substitute |
| A1.en-zh                       | 1.000 ✓ (n=1600)   | 1.000 ✓ (n=1600)   | 1.000 ✓ (n=1600)   | >=0.97                    | public-substitute |
| A1.vi-zh                       | 0.996 ✓ (n=1600)   | 0.996 ✓ (n=1600)   | 0.996 ✓ (n=1600)   | >=0.97                    | public-substitute |
| A2.en-vi                       | —                  | —                  | —                  | >=0.90 raw OR <=0.05 err  | public-substitute |
| A2.en-vi.cv                    | —                  | —                  | —                  | report                    | cv                |
| A2.en-vi.real                  | —                  | —                  | —                  | report                    | real              |
| A2.en-zh                       | —                  | —                  | —                  | >=0.90 raw OR <=0.05 err  | public-substitute |
| A2.en-zh.cv                    | —                  | —                  | —                  | report                    | cv                |
| A2.en-zh.real                  | —                  | —                  | —                  | report                    | real              |
| A2.vi-zh                       | —                  | —                  | —                  | >=0.90 raw OR <=0.05 err  | public-substitute |
| A2.vi-zh.cv                    | —                  | —                  | —                  | report                    | cv                |
| A2.vi-zh.real                  | —                  | —                  | —                  | report                    | real              |
| A3.long.vien                   | 0.997 ✓ (n=600)    | 0.997 ✓ (n=600)    | 0.997 ✓ (n=600)    | >=0.95                    | public-substitute |
| A3.long.zh                     | 0.998 ✓ (n=500)    | 0.998 ✓ (n=500)    | 0.998 ✓ (n=500)    | >=0.95                    | public            |
| A3.short.vien                  | —                  | —                  | —                  | >=0.85                    | public-substitute |
| A3.short.zh                    | —                  | —                  | —                  | >=0.85                    | public            |
| A4                             | —                  | —                  | —                  | >=0.95                    | public-substitute |
| A5                             | 0.900 ✓ (n=80)     | 0.900 ✓ (n=80)     | 0.900 ✓ (n=80)     | >=0.90 rejected           | esc50             |
| A5.esc50                       | 0.900 · (n=80)     | 0.900 · (n=80)     | 0.900 · (n=80)     | report                    | esc50             |
| A6.en-vi.changed               | 0.295 ✗ (n=1200)   | 0.295 ✗ (n=1200)   | 0.295 ✗ (n=1200)   | <=0.10                    | public-substitute |
| A6.en-vi.first_language_p95_ms | 747.524 ✓ (n=1200) | 747.524 ✓ (n=1200) | 747.524 ✓ (n=1200) | <=1000                    | public-substitute |
| A6.en-zh.changed               | 0.170 ✗ (n=1600)   | 0.170 ✗ (n=1600)   | 0.170 ✗ (n=1600)   | <=0.10                    | public-substitute |
| A6.en-zh.first_language_p95_ms | 761.448 ✓ (n=1600) | 761.448 ✓ (n=1600) | 761.448 ✓ (n=1600) | <=1000                    | public-substitute |
| A6.vi-zh.changed               | 0.287 ✗ (n=1600)   | 0.287 ✗ (n=1600)   | 0.287 ✗ (n=1600)   | <=0.10                    | public-substitute |
| A6.vi-zh.first_language_p95_ms | 671.735 ✓ (n=1600) | 671.735 ✓ (n=1600) | 671.735 ✓ (n=1600) | <=1000                    | public-substitute |
| A7                             | 273.103 ✗ (n=5500) | 273.103 ✗ (n=5500) | 273.103 ✗ (n=5500) | <=150 ms p95              | mixed             |
| A9-mono.en                     | —                  | —                  | —                  | <=0.03 err (worst source) | real              |
| A9-mono.vi                     | —                  | —                  | —                  | <=0.03 err (worst source) | real              |
| lock.en-vi.accuracy            | 0.707 · (n=1200)   | 0.707 · (n=1200)   | 0.707 · (n=1200)   | report                    | public-substitute |
| lock.en-zh.accuracy            | 0.830 · (n=1600)   | 0.830 · (n=1600)   | 0.830 · (n=1600)   | report                    | public-substitute |
| lock.vi-zh.accuracy            | 0.714 · (n=1600)   | 0.714 · (n=1600)   | 0.714 · (n=1600)   | report                    | public-substitute |
| zh_real.A1.en-zh               | —                  | —                  | —                  | report                    | real              |
| zh_real.A1.vi-zh               | —                  | —                  | —                  | report                    | real              |
| zh_real.A3                     | —                  | —                  | —                  | report                    | real              |
