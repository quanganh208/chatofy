/**
 * Parse a CSV file into glossary terms, client-side.
 *
 * The API is JSON-only (`importGlossary` takes `{ terms, mode }`), so CSV parsing
 * is the web app's job. The columns are `vi, en, keepVerbatim` in that order;
 * `keepVerbatim` is optional and defaults false. A header row naming the columns
 * is detected and skipped, and blank or half-filled rows are dropped rather than
 * sent as invalid terms.
 *
 * Quoting follows RFC 4180 enough for real files: a field may be wrapped in
 * double quotes to hold a comma or a newline, and a literal quote inside is
 * written `""`. This is deliberately a small parser, not a dependency — the
 * shape is three columns of short strings.
 */
export interface ParsedGlossaryTerm {
  vi: string;
  en: string;
  keepVerbatim: boolean;
}

export function parseGlossaryCsv(text: string): ParsedGlossaryTerm[] {
  const rows = splitCsvRows(text);
  const terms: ParsedGlossaryTerm[] = [];

  rows.forEach((cells, index) => {
    if (index === 0 && looksLikeHeader(cells)) return;
    const vi = (cells[0] ?? '').trim();
    const en = (cells[1] ?? '').trim();
    // A row without both spellings is not a term. Skipping rather than erroring
    // lets a trailing newline or a stray blank line pass without failing the import.
    if (!vi || !en) return;
    terms.push({ vi, en, keepVerbatim: parseBool(cells[2]) });
  });

  return terms;
}

/** Split CSV text into rows of cells, honoring quoted fields and `""` escapes. */
function splitCsvRows(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (normalized.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  row.push(field);
  rows.push(row);

  // Drop rows that are entirely empty — a trailing newline produces one.
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

/** The first row is a header when its first two cells name the columns. */
function looksLikeHeader(cells: string[]): boolean {
  const first = (cells[0] ?? '').trim().toLowerCase();
  const second = (cells[1] ?? '').trim().toLowerCase();
  return (first === 'vi' || first === 'vietnamese') && (second === 'en' || second === 'english');
}

/** `true` / `1` / `yes` (any case) is true; everything else, including absent, is false. */
function parseBool(cell: string | undefined): boolean {
  const value = (cell ?? '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}
