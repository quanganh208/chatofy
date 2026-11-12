/**
 * How many ELEVATED SURFACES a screen draws.
 *
 * "At most two per screen" is the second design rule that used to be checked by
 * eye. A card is for a thing you act on as a unit; everything else is a list, a
 * bar, or a region on the page ground.
 *
 * ## Why not just `[data-slot="card"]`
 *
 * That is what this started as, and it repeats the mistake `accent-count.ts`
 * exists to correct one file over: it counts the COMPONENT rather than the
 * property. A hand-written `<div className="bg-card shadow-elev-md">` is an
 * elevated surface by every rule that matters and would not have been counted —
 * exactly the loophole the accent counter refuses for `bg-primary`.
 *
 * So the shadow tokens are counted too, by exact class token. `shadow-elev-sm` is
 * NOT among them: that is the depth of a control, and a control is an object
 * sitting on a surface rather than a surface.
 *
 * ## Why the root is usually `document.body`
 *
 * Popovers, dialogs and sheets portal out of the tree they are written in. A
 * count scoped to the render container sees none of them, so a card inside an
 * open popover would be invisible to the one check meant to find it.
 */
const SURFACE_SHADOWS = ['shadow-elev-md', 'shadow-elev-lg'];

export function elevatedSurfaces(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll('*')).filter(
    (el) =>
      el.getAttribute('data-slot') === 'card' ||
      // A trailing `!` is Tailwind's important modifier, which a primitive styled
      // against a library's attribute selectors needs (the sonner toast carries
      // `shadow-elev-lg!`). It is the same shadow, so it is the same surface.
      Array.from(el.classList).some((token) => SURFACE_SHADOWS.includes(token.replace(/!$/, ''))),
  );
}
