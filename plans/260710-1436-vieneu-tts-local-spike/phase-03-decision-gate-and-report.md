---
phase: 3
title: Decision gate and report
status: completed
effort: ''
---

# Phase 3: Decision gate and report

## Overview

Áp decision gate lên số liệu Phase 2, ra phán quyết go/no-go, viết báo cáo ngắn để user
quyết có sang vòng tích hợp hay không.

## Decision Gate

| Điều kiện                                                  | Kết luận                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| RTF median ≤ 0.7 **và** chất lượng giọng ≥ ElevenLabs Việt | **GO** — đáng tích hợp vòng sau                             |
| RTF median > 1.0 **hoặc** chất lượng thua rõ ElevenLabs    | **NO-GO** — để lại, chờ server NVIDIA                       |
| 0.7 < RTF ≤ 1.0 (vùng xám)                                 | Trình số cho user quyết theo trade-off cost/offline/quality |

Chất lượng đánh giá chủ quan A/B: tự nhiên, đúng dấu thanh, phát âm số/tên riêng, artefact.

## Implementation Steps

1. Tổng hợp `spike/results.md` → viết báo cáo phán quyết vào
   `plans/reports/from-spike-to-decision-260710-1436-vieneu-tts-verdict-report.md`:
   - Bảng RTF/latency/throughput + config threads tối ưu.
   - Nhận xét chất lượng A/B vs ElevenLabs (3–5 câu đối chứng).
   - Phán quyết GO / NO-GO / vùng xám theo gate.
   - Nếu GO: phác điểm tích hợp vòng sau (VieNeuTtsProvider + Python sidecar HTTP localhost,
     wire vào `packages/ai-providers/src/providers/vieneu/`, `ai-providers.factory.ts`,
     `quality-profile.ts`) — chỉ phác, không code.
2. Trình user số liệu + phán quyết; hỏi có sang vòng tích hợp không.
3. Dọn: giữ `results.md`, .wav mẫu, báo cáo; xóa/hoặc gitignore weights + venv (nặng, throwaway).

## Success Criteria

- [ ] Báo cáo phán quyết có bảng số + kết luận GO/NO-GO rõ ràng.
- [ ] User có đủ dữ kiện để quyết bước tiếp.
- [ ] Artefact nặng (weights, venv) không lọt vào git.

## Risk Assessment

- Vùng xám (RTF 0.7–1.0): tránh tự quyết thay user; trình trade-off, để user chọn.
- Đánh giá chất lượng chủ quan dễ thiên vị: nghe mù (blind) nếu có thể, hoặc ghi rõ là chủ quan.
