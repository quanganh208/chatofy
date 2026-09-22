# Brand mark

How the lotus is drawn, which version goes where, and how the platform assets are
made. Colours come from [design-guidelines.md](./design-guidelines.md#dawn); this is
the mark itself.

Lotus **5a, "Ba cánh"**: two side petals turned ±42° about a shared base, and a taller
centre petal in front. The geometry is data in `packages/ui/src/brand-mark.ts` — a
64-unit square, the two petal paths, the angle, the base, the gap widths and the
gradient stops — and every surface builds its own drawing from it: `BrandMark` in
`@chatofy/ui/react` for web and the popup, `createElementNS` in the overlay (which
parses no markup), and the exporter for rasters.

**The gap is cut, not painted.** A mask removes a 3-unit band (3.5 on the ink variant)
along the centre petal's outline from all three petals. A stroke in the page colour
would look identical on one ground and draw a visible outline on every other,
including a transparent PNG.

| Variant | Petals                                | Where                                                                |
| ------- | ------------------------------------- | -------------------------------------------------------------------- |
| `ink`   | all three in `currentColor`           | below 32px: app sidebar (20), auth frame and popup (20–24), favicon  |
| `dawn`  | ink side petals, dawn gradient centre | 32px and up: the marketing header (32), the Open Graph image         |
| `full`  | every petal in a gradient             | on a night tile (toolbar and app icons) and in the idle overlay pill |

The size rule exists because the dawn centre petal disappears when small.

- **Wordmark.** "chatofy", lowercase, Newsreader 500. Web sets it as live text so it
  selects and scales. Surfaces without Newsreader — the popup, and every raster — use
  the outlined path in `packages/ui/src/brand-wordmark.ts`, generated from a sha-pinned
  Newsreader at wght 500, opsz 24.
- **Favicon.** `apps/web/app/icon.svg` is the ink mark with its own
  `prefers-color-scheme: dark` swap to `#F5F5F4`, so it stays visible on a dark tab
  strip. `favicon.ico` is the night tile, because a browser that ignores the SVG
  cannot swap colours for a dark tab strip either.
- **Toolbar and app icons.** The full-dawn mark on a rounded night tile at every size.
  MV3 has no per-theme toolbar icon, and a night tile reads on light and dark toolbars.
- **Overlay.** The idle pill leads with the full-dawn mark. **While capturing, the pill
  shows the pulsing dot and no mark** — the dot is the recording indicator, and a logo
  in its place would make a live capture look idle. `overlay-pill-mark.spec.ts` holds
  both states.
- **Clear space** is half a petal's width on every side — about 10 of the mark's 64 units. **Don't** rotate the
  mark, recolour single petals, put dawn behind text or on a button, or animate the mark
  beside a translation being read.

Every raster was exported from the geometry in `packages/ui/src/brand-mark.ts` with a
one-off script that is not in the tree, so the committed files are the only record.
Changing the mark means re-exporting each raster listed above by hand and committing the
new bytes.
