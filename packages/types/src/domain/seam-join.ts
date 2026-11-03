/**
 * Join the pieces the utterance ceiling cut one utterance into, repairing the
 * one seam artifact that needs no guessing.
 *
 * Each piece is punctuated as it arrives as a complete text, so one cut by the
 * ceiling is forced to end on whichever of . ? ! the model finds likeliest. The
 * piece after it was punctuated reading that one as context, and a lowercase
 * opening is its verdict that no sentence ended there — so that closing mark is
 * dropped. Words are never touched: a cut can land mid-word, and repairing THAT
 * would mean guessing at a word neither half contains.
 *
 * Shared by the screen, which renders the joined line, and the server, which
 * translates a block as one text: a seam mark left in the text sent to the
 * translator comes back as a sentence break in the middle of the translation
 * ("…tiếng mẹ đẻ. và sau đó…").
 */
export function joinAtSeams(pieces: readonly string[]): string {
  return pieces
    .map((piece, index) => {
      const next = pieces[index + 1];
      return next !== undefined && /[.?!]$/.test(piece) && opensLowercase(next)
        ? piece.slice(0, -1)
        : piece;
    })
    .join(' ');
}

/**
 * Whether a line opens on a lowercase letter — a continuation, not a sentence.
 *
 * A line that opens on a numeral says nothing either way: the ITN turned a
 * capitalised "Bảy" into "7", and reading past it to the next word would mistake
 * a new sentence for the rest of the last one.
 */
function opensLowercase(text: string): boolean {
  const first = text.match(/[\p{L}\p{N}]/u)?.[0];
  return first !== undefined && /\p{L}/u.test(first) && first !== first.toUpperCase();
}
