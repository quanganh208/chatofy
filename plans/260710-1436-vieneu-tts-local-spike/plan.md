---
title: VieNeu-TTS local measurement spike
description: ''
status: completed
priority: P2
branch: main
tags: []
blockedBy: []
blocks: []
created: '2026-07-10T07:45:02.511Z'
createdBy: 'ck:plan'
source: skill
---

# VieNeu-TTS local measurement spike

## Overview

Throwaway measurement spike: dựng VieNeu-TTS (Vietnamese TTS, NeuTTS Air 0.5B) chạy
CPU-only trên dev box, đo RTF + latency + chất lượng giọng Việt, ra quyết định go/no-go
cho việc tích hợp làm TTS chiều en→vi. KHÔNG đụng pipeline NestJS production trong spike này.

Context brainstorm: `../reports/brainstorm-260710-1436-vieneu-tts-local-spike-report.md`

**Hardware:** i7-11700K 8c/16t, 32GB RAM, AMD RX 580 (no CUDA) → CPU-only bắt buộc.

**Decision gate:** RTF ≤ 0.7 + chất lượng ≥ giọng Việt ElevenLabs ⇒ đáng tích hợp (vòng sau).
RTF > 1 hoặc chất lượng thua ⇒ để lại, chờ server NVIDIA.

**VERDICT: GO.** RTF median 0.51 (8 threads), first-audio ~0.30s; chất lượng user chấp nhận.
Chi tiết: `../reports/from-spike-to-decision-260710-1436-vieneu-tts-verdict-report.md`.
Vòng sau: brainstorm chiều en→vi + tích hợp VieNeuTtsProvider + Python sidecar.

## Phases

| Phase | Name                                                                 | Status    |
| ----- | -------------------------------------------------------------------- | --------- |
| 1     | [Setup CPU env](./phase-01-setup-cpu-env.md)                         | Completed |
| 2     | [Benchmark RTF and quality](./phase-02-benchmark-rtf-and-quality.md) | Completed |
| 3     | [Decision gate and report](./phase-03-decision-gate-and-report.md)   | Completed |

## Dependencies

<!-- Cross-plan dependencies -->
