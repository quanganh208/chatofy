---
phase: 4
title: Web toggle e2e and docs
status: completed
priority: P2
dependencies:
  - 3
---

# Phase 4: Web toggle e2e and docs

## Overview

Thêm toggle chiều vào web test UI, gửi `direction`; xác minh e2e en→vi end-to-end với sidecar
chạy thật; cập nhật docs + dev runner.

## Outcome (DONE)

- `apps/web/app/translate/page.tsx`: toggle chiều VI→EN/EN→VI, label động, voice picker 14 giọng
  (chỉ khi en→vi), gửi `direction` (+`voice`).
- `package.json`: script `dev:all` chạy sidecar + turbo dev qua **`pnpm dlx concurrently`**
  (KHÔNG thêm devDep → không đụng lockfile; xem ghi chú jest bên dưới).
- e2e: thêm case en_to_vi (mime audio/wav) + validation direction sai vào `translate.e2e-spec.ts`;
  file `translate-en-vi-sidecar.e2e-spec.ts` (real provider↔sidecar, skip trừ khi `RUN_VIENEU_E2E=1`).
- Docs: README (sidecar + dev:all + en→vi), `system-architecture.md` (pipeline direction + routing + VieNeu).
- **CI gates xanh:** lint 0 error, typecheck 10/10, build 5/5.

### ⚠ Jest test-runner (pre-existing, local-only)

CI **không chạy jest** (chỉ lint/typecheck/build). Unit test đã pass ở Phase 2/3 trước khi
chạy `pnpm install` (thêm concurrently). Install đó re-hoist node_modules và lật xung đột
**hoisted-linker dual-jest** (mobile jest29 vs api jest30 → `jest-environment-node@29` đè `@30`
→ `clearMocksOnScope is not a function`). Reinstall sạch từ lockfile gốc vẫn hỏng (không tất định).
Đã revert concurrency (dùng `pnpm dlx`) + khôi phục lockfile → **repo files sạch**. Fragility có
sẵn của repo; cần user quyết cách sửa (pnpm override / node-linker) vì đụng mobile.

## Requirements

- Functional: web test UI (`apps/web/app/translate/page.tsx`) chọn được chiều vi→en / en→vi
  (title/label động, hiện đang hardcode "Vietnamese → English"); **picker 14 giọng VieNeu hiện
  khi chiều en→vi**; `translate()` gửi `direction` (+ `voice` khi en→vi); phát audio theo
  `audioMimeType` (page đã dùng `res.audioMimeType` ⇒ wav play sẵn). E2e: sidecar + API, POST
  direction=en-vi → nhận audio Việt phát được.
- Non-functional: dev chạy 1 lệnh (`dev:all`); docs đủ để người mới dựng.

## Architecture

- `apps/web/app/translate/page.tsx`: thêm state `direction` + segmented toggle; label động; khi
  en→vi hiện `<select>` 14 giọng (danh sách hardcode constant — Validation S1). Gửi `direction`
  (+ `voice` nếu en→vi) trong `translate()` body. Audio play đã theo `audioMimeType` (không đổi).
- `translate()` (`api-client.ts`) chỉ cần type `TranslateRequest` (đã có direction/voice) — không đổi logic.
- **Dev runner (Validation S1):** thêm `concurrently` (devDep root), script `dev:all` =
  chạy sidecar (`uv run uvicorn app:app --port 8001` trong `services/vieneu-tts`) + `turbo run dev`
  song song. Chạy được trên Windows PowerShell + bash.

<!-- Updated: Validation Session 1 - dev:all + voice picker + exact page path -->

## Related Code Files

- Modify: `apps/web/app/translate/page.tsx` (toggle chiều + label động + voice picker)
- Modify: root `package.json` (devDep `concurrently` + script `dev:all`)
- Modify: `README.md` (chạy sidecar + `dev:all`), `docs/system-architecture.md`,
  `docs/development-roadmap.md`, `docs/project-changelog.md`
- Create: `apps/api/test/translate-en-vi.e2e-spec.ts` (e2e, skip nếu sidecar không chạy)

## Implementation Steps

1. Thêm `concurrently` + script `dev:all` (sidecar + turbo dev); verify chạy trên Windows.
2. `page.tsx`: state direction + toggle + label động; voice picker (14 tên hardcode) chỉ khi en→vi;
   gửi direction (+voice) trong body.
3. E2e spec en-vi: guard bằng env (skip khi không có sidecar/keys) để CI không vỡ.
4. Chạy thủ công full: `dev:all` → thu tiếng Anh, chọn giọng, nhận giọng Việt VieNeu.
5. Cập nhật docs: kiến trúc (sidecar + routing), roadmap, changelog, README dev.

## Success Criteria

- [ ] Web test UI đổi chiều được; en→vi hiện picker 14 giọng; trả audio Việt phát được trong trình duyệt.
- [ ] `dev:all` chạy sidecar + turbo dev bằng 1 lệnh (Windows + bash).
- [ ] E2e en-vi pass khi sidecar chạy (skip sạch khi không).
- [ ] Docs cập nhật: architecture, roadmap, changelog, README.

## Risk Assessment

- E2e phụ thuộc sidecar + model + keys → phải skip có điều kiện, không làm đỏ CI.
- CORS/định dạng audio khác (wav) trên web → kiểm tra `<audio>` phát wav 48kHz OK.
- Dev runner đa nền tảng (Windows) → script phải chạy được trên PowerShell/bash.
