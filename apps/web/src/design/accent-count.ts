/**
 * How many controls on a surface read as THE action.
 *
 * "One accent-filled control per screen" is the one design rule with no full
 * mechanical check, and `.claude/rules/development-rules.md` says so in the same
 * breath as the rule itself. This is the counting half of that check, shared by
 * the section-level marketing spec and the screen-level app spec so that two
 * gates cannot drift into two different definitions of "accent-filled".
 *
 * ## Two things the obvious selector gets wrong
 *
 * The obvious selector is `querySelectorAll('[class*="bg-primary"]')`, and it is
 * what the marketing spec used. On a marketing section it is correct. On an app
 * screen it fails twice:
 *
 * 1. **`[class*=]` is a substring match.** `switch.tsx` carries
 *    `data-[state=checked]:bg-primary` — a Tailwind state variant, present in the
 *    class attribute whether the switch is on or off. Any screen with a `Switch`
 *    would fail on sight. `classList.contains` is an exact token match, so a
 *    variant class does not count.
 * 2. **It counts things that are not controls.** `slider.tsx` paints its filled
 *    range `bg-primary` on a `div`, and `brand.tsx` puts a `bg-primary` square
 *    inside the brand link. Both are readouts of state, not the screen's action.
 *
 * Restricting to `button, a, [role="button"]` drops both: the slider range is a
 * `div`, and the brand square is a `span` inside the anchor rather than the
 * anchor itself.
 *
 * ## Why not `[data-variant="default"]`
 *
 * `button.tsx` stamps `data-variant`, so that selector is available and simpler.
 * It is also blind to the failure this rule exists to catch: a hand-written
 * `bg-primary` on an element that is not a `Button` spends exactly the same
 * budget, and the marketing spec's own comment says so. Counting the class keeps
 * that covered.
 *
 * ## Which root to hand it
 *
 * `document.body` wherever a screen can open something. Popovers, dialogs and
 * sheets portal out of the tree they are written in, so a filled control inside
 * an open one is invisible to a count scoped to the render container — and the
 * densest clusters of controls in this app are exactly those panels. That is why
 * `surface-count.ts` says the same thing about cards, and the app spec passes the
 * document to both.
 *
 * The marketing spec passes its container instead, and that stays correct: a
 * static section portals nothing, and its own root is what bounds the SECTION it
 * is counting.
 */
export function accentFilledControls(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll('button, a, [role="button"]')).filter((el) =>
    el.classList.contains('bg-primary'),
  );
}
