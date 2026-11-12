/** How long a download's object URL outlives the click — see `saveBlob`. */
export const REVOKE_AFTER_MS = 60_000;

/**
 * Hand a Blob to the browser as a download.
 *
 * A temporary `<a download>` is the one way that works in every browser without a
 * new tab. The object URL is revoked a minute later, not on the next task: Firefox
 * and Safari read a large blob (a recording of several MB) after the click returns,
 * and revoking it early aborts the download. Never revoking it would keep the
 * bytes alive for the life of the page; one blob held for a minute is harmless.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
}

/**
 * Text as a UTF-8 file. `bom` prefixes the byte-order mark, which is what makes
 * Notepad and older Windows subtitle players read Vietnamese as UTF-8 rather than
 * as the system code page; Markdown tools are UTF-8 already and some print the
 * mark, so it is opt-in.
 */
export function textBlob(text: string, type: string, bom: boolean): Blob {
  return new Blob([bom ? `\uFEFF${text}` : text], { type: `${type};charset=utf-8` });
}
