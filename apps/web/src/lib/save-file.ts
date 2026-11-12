/**
 * Hand a Blob to the browser as a download.
 *
 * A temporary `<a download>` is the one way that works in every browser without a
 * new tab. The object URL is revoked on the next task rather than synchronously:
 * revoking it in the same task as the click cancels the download in some engines,
 * and leaving it would keep the bytes alive for the life of the page.
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
    setTimeout(() => URL.revokeObjectURL(url), 0);
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
