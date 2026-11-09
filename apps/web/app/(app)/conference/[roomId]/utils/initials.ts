/**
 * Up to two initials for a tile with no picture: first and last word, so "UX Audit A"
 * is "UA" and "Lan" is "L". Shared by the lobby preview and the in-call tile so a
 * person looks the same before and after they join.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return picked.map((word) => word!.charAt(0).toUpperCase()).join('');
}
