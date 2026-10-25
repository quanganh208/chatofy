## Per voice (zh, 30 sentences)

| Arm                 | sid | Speaker     | CER SenseVoice % | CER Paraformer % | mean s | p50 s | p95 s | RTF   | Peak RSS MB |
| ------------------- | --- | ----------- | ---------------- | ---------------- | ------ | ----- | ----- | ----- | ----------- |
| kokoro-v1_0-en-zh   | 45  | zf_xiaobei  | 3.8              | 4.5              | 1.22   | 1.21  | 1.62  | 0.325 | 667         |
| kokoro-v1_0-en-zh   | 46  | zf_xiaoni   | 25.4             | 30.1             | 1.08   | 1.11  | 1.42  | 0.324 | 645         |
| kokoro-v1_0-en-zh   | 47  | zf_xiaoxiao | 1.8              | 2.9              | 0.98   | 0.99  | 1.29  | 0.302 | 639         |
| kokoro-v1_0-en-zh   | 48  | zf_xiaoyi   | 2.2              | 2.5              | 1.10   | 1.12  | 1.51  | 0.349 | 643         |
| kokoro-v1_0-en-zh   | 49  | zm_yunjian  | 2.2              | 2.5              | 1.08   | 1.07  | 1.50  | 0.333 | 643         |
| kokoro-v1_0-en-zh   | 50  | zm_yunxi    | 2.9              | 2.5              | 1.02   | 1.06  | 1.37  | 0.341 | 641         |
| kokoro-v1_0-en-zh   | 51  | zm_yunxia   | 2.0              | 2.2              | 1.08   | 1.10  | 1.44  | 0.326 | 647         |
| kokoro-v1_0-en-zh   | 52  | zm_yunyang  | 2.5              | 3.3              | 0.93   | 0.97  | 1.24  | 0.320 | 596         |
| kokoro-v1_1-int8-zh | 3   | zf_001      | 2.5              | 2.9              | 4.41   | 4.42  | 5.61  | 1.254 | 499         |
| kokoro-v1_1-int8-zh | 4   | zf_002      | 2.9              | 2.7              | 5.01   | 5.07  | 6.48  | 1.260 | 506         |
| kokoro-v1_1-int8-zh | 5   | zf_003      | 3.6              | 3.8              | 5.33   | 5.34  | 6.84  | 1.313 | 510         |
| kokoro-v1_1-int8-zh | 6   | zf_004      | 3.6              | 2.5              | 5.08   | 5.25  | 6.80  | 1.265 | 515         |
| kokoro-v1_1-int8-zh | 58  | zm_009      | 3.8              | 3.3              | 4.83   | 4.92  | 6.14  | 1.362 | 498         |
| kokoro-v1_1-int8-zh | 59  | zm_010      | 2.2              | 2.9              | 4.66   | 4.73  | 5.87  | 1.294 | 500         |
| kokoro-v1_1-int8-zh | 60  | zm_011      | 2.9              | 3.8              | 4.59   | 4.46  | 6.26  | 1.313 | 504         |
| kokoro-v1_1-int8-zh | 61  | zm_012      | 2.9              | 2.9              | 4.62   | 4.71  | 5.93  | 1.241 | 505         |

## Per arm

| Arm                 | Chosen F / M                      | CER SV (chosen) | CER PF (chosen) | CER SV (all voices) | CER PF (all voices) | Peak RSS MB (max) |
| ------------------- | --------------------------------- | --------------- | --------------- | ------------------- | ------------------- | ----------------- |
| kokoro-v1_0-en-zh   | zf_xiaoxiao (47) / zm_yunxia (51) | 1.9             | 2.6             | 5.4                 | 6.3                 | 667               |
| kokoro-v1_1-int8-zh | zf_001 (3) / zm_010 (59)          | 2.3             | 2.9             | 3.0                 | 3.1                 | 515               |

Decision: reuse v1_0 unless v1_1 CER is lower by > 2 points under both judges. v1_0 − v1_1 CER points: sensevoice-zh -0.4, paraformer-zh -0.3. Winner: **kokoro-v1_0-en-zh**.

## Worst 5 — kokoro-v1_0-en-zh

| Speaker     | id   | CER SV / PF | Reference                   | SenseVoice                         | Paraformer                          |
| ----------- | ---- | ----------- | --------------------------- | ---------------------------------- | ----------------------------------- |
| zf_xiaoxiao | s015 | 25 / 31     | 今年公司的销售额增长了15%。 | 今年公司的销售额增长了十五 percent | 今年公司的销售额增长了十五 per 三定 |
| zm_yunxia   | s015 | 25 / 25     | 今年公司的销售额增长了15%。 | 今年公司的销售额增长了十五 but     | 今年公司的销售额增长了十五 percent  |
| zm_yunxia   | s024 | 20 / 20     | 我刚下载了ChatGPT的新版本。 | 我刚下载了叉 g b g 的新版本        | 我刚下载了杀 g b g 的新版本         |
| zf_xiaoxiao | s024 | 10 / 20     | 我刚下载了ChatGPT的新版本。 | 我刚下载了 x g b g 的新版本        | 我刚下载了叉 g b g 的新版本         |
| zf_xiaoxiao | s006 | 8 / 17      | 现在的AI工具越来越好用了。  | 现在的 i工具越来越好用了           | 现在 di 工具越来越好用了            |

## Worst 5 — kokoro-v1_1-int8-zh

| Speaker | id   | CER SV / PF | Reference                   | SenseVoice                   | Paraformer                    |
| ------- | ---- | ----------- | --------------------------- | ---------------------------- | ----------------------------- |
| zf_001  | s015 | 25 / 25     | 今年公司的销售额增长了15%。 | 今年公司的销售额增长了十五片 | 今年公司的销售额增长了十五片  |
| zm_010  | s015 | 25 / 25     | 今年公司的销售额增长了15%。 | 今年公司的销售额增长了十五三 | 今年公司的销售额增长了十五三  |
| zf_001  | s024 | 20 / 20     | 我刚下载了ChatGPT的新版本。 | 我刚下载了叉 g p t 的新版本  | 我刚下载了叉 g p t 的新版本   |
| zm_010  | s024 | 20 / 20     | 我刚下载了ChatGPT的新版本。 | 我刚下载了杀 g p t 的新版本  | 我刚下载了啥 g p ity 的新版本 |
| zf_001  | s006 | 17 / 8      | 现在的AI工具越来越好用了。  | 现在的绿 r工具越来越好用了   | 现在的 ar 工具越来越好用了    |

## en regression (v1_0, en-only vs en+zh config)

| sid | Speaker  | identical samples (vs en-only / control) | identical length (vs en-only / control) | p95 en-only / en-zh / control s | p95 Δ % | WER en-only / en-zh / control % | Pass |
| --- | -------- | ---------------------------------------- | --------------------------------------- | ------------------------------- | ------- | ------------------------------- | ---- |
| 9   | af_sarah | 0/30 / 0/30                              | 8/30 / 9/30                             | 1.02 / 1.01 / 1.03              | -1.4    | 4.8 / 4.8 / 4.8                 | yes  |
| 11  | am_adam  | 0/30 / 0/30                              | 8/30 / 4/30                             | 0.94 / 0.92 / 0.90              | -1.9    | 4.5 / 4.5 / 4.5                 | yes  |

en verdict: **PASS (p95 within ±10%, WER within run-to-run control)**
