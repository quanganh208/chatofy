/**
 * The React entry: components for the two DOM surfaces.
 *
 * Separate from the root export, and that separation is the whole point.
 * `apps/mobile` imports `@chatofy/ui` through Metro, which must never resolve
 * React, Radix or anything with a DOM type in it. Nothing here is reachable from
 * there — a subpath is only resolved when it is asked for by name.
 *
 * Not for the meeting overlay either, though for a different reason.
 * `apps/extension/entrypoints/content/` renders into a closed shadow root under
 * `:host { all: initial }`, which does not reset custom properties — so a
 * var()-themed overlay is repaintable by the meeting page it sits on.
 * `overlay-invariants.spec.ts` enforces that, and every Tailwind utility emits a
 * custom property. The overlay keeps its hand-written string.
 *
 * Components arrive from Phase 4 onward.
 */
export { cn } from '../lib/utils.js';
