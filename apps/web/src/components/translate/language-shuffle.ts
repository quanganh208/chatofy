/**
 * The language swap, drawn as the two sheets trading places like cards.
 *
 * A swap changes which language each side holds. Without motion the two headers just
 * change their words in place, and the reader has to read both again to see what
 * happened. So each sheet is marked with the language it holds (`data-shuffle-card`),
 * measured before the swap and again after, and each one travels from where its
 * language was to where it is now — FLIP, on the Web Animations API, so nothing is
 * left behind in inline styles. Its ground travels with it: the sheet arriving on the
 * translation side starts on the source side's colour and settles into its own.
 *
 * Two sheets that only slid would cross through each other. Like a shuffle, one lifts
 * over and the other dips under: the first in document order rises, grows a little
 * and tilts, and the other sinks and shrinks, both at right angles to the way they
 * travel. So the same code reads right side by side, where the sheets move across,
 * and stacked on a phone, where they move up and down.
 *
 * `duration.slow` on `easing.standard` (`docs/design-guidelines.md` § Motion): a
 * control changing state, and the panes are empty or finished whenever a swap is
 * possible (the swap is disabled while a conversation runs), so nothing being read
 * moves. Skipped under reduced motion and in a hidden tab.
 */

const DURATION_MS = 320;
const EASING = 'cubic-bezier(0.2, 0, 0, 1)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
/** How far a card leaves its straight path at the midpoint, in px. */
const LIFT_PX = 18;

export type ShuffleSnapshot = Map<string, { rect: DOMRect; background: string }>;

/** Where each sheet sits right now and what it is painted, by the language it holds. */
export function captureShuffle(root: HTMLElement | null): ShuffleSnapshot | null {
  if (!root) return null;
  const snapshot: ShuffleSnapshot = new Map();
  for (const card of root.querySelectorAll<HTMLElement>('[data-shuffle-card]')) {
    const code = card.dataset.shuffleCard;
    if (!code) continue;
    snapshot.set(code, {
      rect: card.getBoundingClientRect(),
      background: getComputedStyle(card).backgroundColor,
    });
  }
  return snapshot;
}

/** Moves each sheet from where its language was in `before` to where it is now. */
export function playShuffle(root: HTMLElement | null, before: ShuffleSnapshot | null): void {
  if (!root || !before) return;
  const view = root.ownerDocument.defaultView;
  if (!view || root.ownerDocument.hidden || view.matchMedia?.(REDUCED_MOTION).matches) return;

  const cards = [...root.querySelectorAll<HTMLElement>('[data-shuffle-card]')];
  cards.forEach((card, index) => {
    const from = before.get(card.dataset.shuffleCard ?? '');
    if (!from || typeof card.animate !== 'function') return;
    const to = card.getBoundingClientRect();
    const dx = from.rect.left - to.left;
    const dy = from.rect.top - to.top;
    const background = getComputedStyle(card).backgroundColor;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;

    // Over for the first card, under for the second, at right angles to the travel.
    const over = index === 0;
    const lift = over ? -LIFT_PX : LIFT_PX * 0.7;
    const across = Math.abs(dx) >= Math.abs(dy);
    const midX = dx / 2 + (across ? 0 : lift);
    const midY = dy / 2 + (across ? lift : 0);
    const tilt = over ? -1.5 : 1;
    const scale = over ? 1.02 : 0.97;

    // Under the swap (`z-20`), which stays on top while they cross.
    card.style.zIndex = over ? '12' : '11';
    const animation = card.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)`, backgroundColor: from.background },
        {
          transform: `translate(${midX}px, ${midY}px) rotate(${tilt}deg) scale(${scale})`,
          offset: 0.5,
        },
        { transform: 'none', backgroundColor: background },
      ],
      { duration: DURATION_MS, easing: EASING },
    );
    const settle = () => {
      card.style.zIndex = '';
    };
    animation.addEventListener('finish', settle);
    animation.addEventListener('cancel', settle);
  });

  // The round swap turns half a turn with them, swelling slightly at the midpoint.
  for (const button of root.querySelectorAll<HTMLElement>('[data-shuffle-icon]')) {
    if (typeof button.animate !== 'function') continue;
    button.animate(
      [
        { transform: 'rotate(0deg) scale(1)' },
        { transform: 'rotate(90deg) scale(1.12)', offset: 0.5 },
        { transform: 'rotate(180deg) scale(1)' },
      ],
      { duration: DURATION_MS, easing: EASING },
    );
  }
}
