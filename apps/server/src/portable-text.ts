/** UTF-8 encoding would replace an unmatched UTF-16 surrogate with U+FFFD. */
export function hasUnpairedSurrogate(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint >= 0xd800 && codePoint <= 0xdfff;
  });
}

/** XML 1.0 Fifth Edition's Char production, not arbitrary entity expansion. */
export function isXml10CodePoint(codePoint: number) {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}
