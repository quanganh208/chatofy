import qrcode from 'qrcode-generator';

/**
 * The module grid of a QR code, and the one SVG path that draws its dark modules.
 *
 * Encoding is done by `qrcode-generator` (MIT, no dependencies). This only reads its grid
 * back, so the page can draw the symbol as a React SVG with no raw HTML injected: the input
 * is a meeting link, and nothing the library returns is ever parsed as markup.
 *
 * Error correction is level M (about 15% of the symbol can be damaged and still scan), the
 * usual balance for a code held up to a phone camera or shown on a shared screen. The version
 * is chosen automatically (`0`) from the length of the text.
 */
export function qrMatrix(text: string): { size: number; modules: boolean[][]; path: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();

  const modules: boolean[][] = [];
  for (let row = 0; row < size; row++) {
    const cells: boolean[] = [];
    for (let col = 0; col < size; col++) cells.push(qr.isDark(row, col));
    modules.push(cells);
  }

  // One `M x y h<run> v1 h-<run> z` per horizontal run of dark modules, not one square per
  // module: a symbol this size has hundreds of dark modules and far fewer runs.
  let path = '';
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (!modules[row]![col]) {
        col++;
        continue;
      }
      let end = col;
      while (end < size && modules[row]![end]) end++;
      const run = end - col;
      path += `M${col} ${row}h${run}v1h-${run}z`;
      col = end;
    }
  }

  return { size, modules, path };
}
