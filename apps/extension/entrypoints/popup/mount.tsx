import { createRoot } from 'react-dom/client';
import { Button } from '@chatofy/ui/react';

import './theme.css';

/**
 * The React and Tailwind toolchain, standing next to the popup it will replace.
 *
 * This file exists to be deleted. It goes when `main.ts` becomes components; it
 * is the step before that, and it is separate on purpose — putting up a
 * toolchain and rewriting four hundred lines are two different kinds of failure,
 * and mixed together neither one is diagnosable. What it proves is narrow and
 * worth proving: that Vite through WXT resolves `@chatofy/ui/react`, that a
 * package component renders inside an extension page, that its classes survive
 * Tailwind's source scanning from a built dependency, and that MV3's CSP has no
 * objection to any of it.
 *
 * The stylesheet is imported here rather than linked from `index.html`, because
 * an HTML `<link>` would need a path into the build output that only the bundler
 * knows. `theme.css` is imported directly and no popup-level stylesheet sits
 * between: it already carries `@import 'tailwindcss'`, and a file whose whole
 * content is one `@import` of it would be a level of indirection standing for
 * nothing. One can be added when there are popup rules to put in it.
 *
 * Loading it from here does mean the popup gets Preflight, which resets elements
 * the hand-written CSS in `styles.ts` styles. Measured across every element in
 * the popup rather than assumed: nothing that renders moved. `styles.ts` is
 * unlayered and Preflight is not, so the hand-written rules win wherever they
 * declare anything — see the note in `theme.css`, which is where that balance is
 * actually set up and where it is easy to break.
 */

const host = document.getElementById('react-probe');

if (host) {
  createRoot(host).render(
    <div className="border-border flex items-center gap-3 border-t p-3">
      <span className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
        Shared UI
      </span>
      <Button size="sm">Button</Button>
    </div>,
  );
}
