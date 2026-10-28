/**
 * Give a second window this page's look: its stylesheets, its fonts, its theme.
 *
 * The caption window — Document Picture-in-Picture, or a popup where that does not
 * exist — starts as an empty `about:blank` document with nothing in its head.
 * React renders into it through a portal, but CSS does not travel with
 * components: every `<link rel=stylesheet>` and `<style>` on this page has to be
 * copied across, or the captions arrive unstyled.
 *
 * ## Copied, then kept in step
 *
 * The page's head is not fixed after load. The dev server injects and replaces
 * `<style>` tags on every edit, and a route can add a stylesheet late. So the copy
 * is followed by an observer that mirrors additions and removals while the
 * window is open — otherwise the window keeps the styles of the moment it opened.
 *
 * The theme is the class on `<html>` (`light` / `dark`, see `app/layout.tsx`), and
 * the `next/font` variables live there too. Both are mirrored on every change, so
 * switching the theme on the page switches it in the window.
 */
export function cloneDocumentStyles(from: Document, to: Document): () => void {
  const copies = new Map<Node, Node>();

  const copy = (node: Node) => {
    if (!isStyleNode(node) || copies.has(node)) return;
    const clone = to.importNode(node, true);
    copies.set(node, clone);
    to.head.append(clone);
  };

  from.head.childNodes.forEach(copy);
  const mirrorRoot = () => {
    to.documentElement.className = from.documentElement.className;
    to.documentElement.lang = from.documentElement.lang;
  };
  mirrorRoot();

  const heads = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach(copy);
      record.removedNodes.forEach((node) => {
        copies.get(node)?.parentNode?.removeChild(copies.get(node)!);
        copies.delete(node);
      });
      // A `<style>` whose text the dev server rewrote in place.
      if (record.type === 'characterData' || record.target !== from.head) {
        const owner = styleOwner(record.target);
        const clone = owner ? copies.get(owner) : undefined;
        if (owner && clone) clone.textContent = owner.textContent;
      }
    }
  });
  heads.observe(from.head, { childList: true, subtree: true, characterData: true });

  const root = new MutationObserver(mirrorRoot);
  root.observe(from.documentElement, { attributes: true, attributeFilter: ['class', 'lang'] });

  return () => {
    heads.disconnect();
    root.disconnect();
  };
}

function isStyleNode(node: Node): node is HTMLStyleElement | HTMLLinkElement {
  if (node.nodeName === 'STYLE') return true;
  return node.nodeName === 'LINK' && (node as HTMLLinkElement).rel === 'stylesheet';
}

function styleOwner(node: Node): Node | null {
  let current: Node | null = node;
  while (current && current.nodeName !== 'STYLE') current = current.parentNode;
  return current;
}
