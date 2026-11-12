# Translate skeleton redrawn, sidebar left to the reader

2026-11-10

## What changed

- The translate skeleton still drew the old single box. It now draws the two-sheet screen: two hairline sheets (card and muted), each with a header, the round swap between them, and the three-part dock. It lives in `translate/translate-skeleton.tsx`, and `/translate/one-way` and `/translate/two-way` each gained a `loading.tsx` that uses it. Route navigation used to show the route group's generic blocks.
- The translator no longer forces the sidebar into a rail. The reader's last toggle is kept in the `sidebar_state` cookie, which the primitive already wrote and nothing read, and `app/(app)/layout.tsx` reads it on the server. Only the conference room still opens as a rail.
- Whether the sheets sit side by side is now a container query (`@xl`, 36rem), not the `sm` viewport breakpoint.

## What the measuring found

- Comparing the skeleton (server HTML, JS chunks blocked) with the live screen by `getBoundingClientRect` got every box within 2px at 1440, 768 and 375, in both modes. The first pass was off by 15px on Start (`w-52` against a 193px button) and by 3px on the status readout.
- Blocking `_next/static/chunks/**` to keep the skeleton on screen also blocked Turbopack's CSS, because it serves CSS from the same folder. Block `**/*.js` only.
- Once the sidebar stays open at 768px, the content column is about 464px. The sheets went side by side from `sm`, and the two-way headers need about 546px, so the page scrolled 53px sideways. The translator had always been a rail, which hid this. The container query fixes it.
- The local API was on the `chatofy_review` database, not `chatofy`, so the first cleanup deleted nothing. Read `DATABASE_URL` from the process environment before cleaning up.
