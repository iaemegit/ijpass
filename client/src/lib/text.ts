const minorTitleWords = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet',
  'as', 'at', 'by', 'from', 'in', 'into', 'of', 'on', 'over', 'per', 'to', 'via', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'that', 'this', 'these', 'those'
]);

const preservedAcronyms = new Set([
  'ai', 'ml', 'stem', 'cmos', 'vlsi', 'fpso', 'spm', 'iot', 'ict', 'it', 'dna', 'rna', 'gis', 'erp', 'hr', 'hrm'
]);

const capitalizePart = (part: string) => part.replace(/\p{L}/u, letter => letter.toLocaleUpperCase());

export const toArticleTitleCase = (value: string) => {
  const words = value.trim().toLocaleLowerCase().split(/\s+/);
  return words.map((word, index) => {
    const plain = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!plain) return word;
    const shouldPreserve = preservedAcronyms.has(plain);
    const isMinor = minorTitleWords.has(plain);
    if (isMinor && index > 0 && index < words.length - 1) return word;
    if (shouldPreserve) return word.replace(plain, plain.toLocaleUpperCase());
    return word.split('-').map(capitalizePart).join('-');
  }).join(' ');
};

export const toShortArticleTitle = (value: string, wordLimit = 4) => {
  const title = toArticleTitleCase(value);
  const words = title.split(/\s+/).filter(Boolean);
  return words.length > wordLimit ? `${words.slice(0, wordLimit).join(' ')}...` : title;
};
