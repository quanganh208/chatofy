---
title: Polisher with context fixes vi-en translations
date: 2026-11-02
---

# Polisher with context fixes vi-en translations

Replayed the prod polisher over the 162 judged turns with deepseek-v4-pro. vi→en serious mt: stored 23.7%, polisher without context (prod) 9.2%, with the earlier turns 1.3% (paired CI [−40.4, −11.6] pts); en→vi unhurt, CometKiwi 0.753→0.768, p95 2.5 s. Arm 3 (critique-then-rewrite) not needed.

Shipped locally: TurnPolisher takes `context`; both call sites pass ConversationContext.recall read BEFORE context.remember (otherwise the turn would be its own context — caught while reading the code, pinned by a spec). 1701 API tests, tsc and eslint clean.

Design note: arms judge only rewritten rows and reuse baseline judgements for untouched ones — cheaper and removes judge noise from the diff. My own --limit-calls guard stopped the first judge run; rerun with explicit limits.

Open: gpt-5.6-sol re-run after 2026-11-04; push/PR/deploy awaits the user; prod log check after deploy.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
