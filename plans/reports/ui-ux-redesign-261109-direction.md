# UI/UX redesign: direction and IA (phase 2, Gate A)

Date: 2026-11-09. Evidence: `ui-ux-redesign-261109-baseline/report.md`.

The owner asked for the remaining phases to run without further questions, so Gate A was
answered with the plan's own recommendations. **Every answer below is an assumption the
owner can overrule**; the cost of each reversal is noted.

## Gate A decisions (assumed)

| #   | Question          | Decision                                                                                                                                                                                                            | Reversal cost                        |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | Keep Direction A? | **Keep.** The baseline shows the look is already calm and strong on the public pages; the weakness is guidance, labelling and edge cases, not the palette or type.                                                  | A new direction is a new plan        |
| 2   | Toast or inline?  | **Inline confirmation.** A toast counts as an elevated surface under the two-surface budget, adds a dependency (sonner) and nothing in the baseline needs it: copy, save and delete already change on-screen state. | Add sonner later, update budget spec |
| 3   | Command palette?  | **Out of scope.** Seven sidebar destinations and a skip link do not justify cmdk. Visible shortcut hints are not added either: nothing was found hard to reach.                                                     | Add cmdk later                       |
| 4   | Demo route        | **`/translate`** (one-way first). It is the first screen after sign-in and the thesis story. `/conference` second.                                                                                                  | Reorder phase 4                      |
| 5   | Third-party tools | impeccable run (read-only). hallmark and Emil skills **not installed** (they write into `.claude/`).                                                                                                                | Install, re-run 1.8                  |
| 6   | Landing page      | **App routes only**, plus the cheap typographic fix on the landing (`text-wrap`).                                                                                                                                   | Add a landing pass                   |
| 7   | Beauty references | No references supplied; used the calm-editorial density of the existing landing as the bar. Target: the app screens reach the landing's level (3) without new colour or decoration.                                 | Supply references, redo phase 2.4    |

## Core journeys and friction

**T1 Translate a sentence** (`/translate/one-way`)

1. Land on the screen after sign-in. Two large empty panels and an unexplained row of dots.
2. Press "Start conversation". The browser asks for the microphone.
3. Speak and read the translation in the right pane.

Friction: nothing says what the panels are for beyond a hint line; the three icon-only
buttons bottom right have no visible words; the dots beside "Not listening" are unexplained;
a 20-Tab keyboard path to the start button (skip link mitigates it).
Fix: label the unexplained controls and the dots, keep the single ink action, add a short
dismissible first-run line that disappears once the user has started a session.

**T2 Start a meeting** (`/conference`)

1. Open Conference. One action and one field, very sparse.
2. "New meeting", then share the link.

Friction: low; "Join" reads as a disabled grey button until a code is typed (by design).
Fix: none required for usability; check the post-create screen in phase 4.

**T3 Find a past conversation** (`/history`)

1. Open History, scan the list, open one.

Friction: speaker line overflows the page (D1); transcripts with long tokens overflow (D2).
Fix: wrap long strings.

**T4 Change interface language**: language button in the top bar (32px target) and in
`/preferences`. Fix: enlarge the target.

## Information architecture

Keep the sidebar as is: One-way, Two-way, Conference, History, Glossary, then Preferences and
Account. Order follows frequency of use; labels are plain words. Changes:

- Empty states explain purpose in one sentence (Glossary: what it is and why to create one).
- Icon-only controls get a visible text or tooltip.
- No new destinations.

## Layout options for `/translate`

|                   | A. Guided two-pane (recommended)                                            | B. Single focus column                                                     |
| ----------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| What              | Keep the two panes; add first-run line, labelled controls, explained status | One wide column with source above, translation below, large mic centre     |
| Accent / surfaces | 1 accent (Start), surfaces unchanged                                        | 1 accent, one fewer surface                                                |
| Memorable detail  | Status line that says in words what the app is doing                        | Mic as the hero                                                            |
| Risk              | Low: reuses the tested layout and readiness banner                          | High: rewrites a layout with turn-keyed transcript logic and several specs |
| Verdict           | **Chosen**                                                                  | Skip                                                                       |

These were reasoned from the existing code and screenshots, not prototyped: no prototype
tool was installed (see decision 5).

## Plan for phases 3 to 6 (scoped from the above)

- 3 Foundations: D1, D2, D3; 44px hit areas for the theme triple, sidebar toggle and language
  button on touch widths; `text-wrap` on landing prose and headings.
- 4 Core flows: translate first-run and labels; glossary empty state; confirm conference and
  history states; both locales.
- 5 Feedback: inline confirmation only; no new dependency; no palette.
- 6 Verify: tests, lint, typecheck, re-capture, compare with the baseline.
