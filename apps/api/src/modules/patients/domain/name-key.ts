/**
 * `name_key`: the normalized form of a patient's full name used for diacritics-insensitive
 * matching (search, duplicate detection). NFD-decomposes the string so precomposed accented
 * letters (`é`) split into a base letter plus a combining mark, then strips every combining mark
 * (`\p{M}`) — this covers both Latin diacritics and Arabic tashkeel (harakat), which are encoded
 * as combining marks to begin with, so NFD leaves them untouched but the strip removes them all
 * the same. Finally lower-cased and whitespace-collapsed. Pure; no I/O (CLAUDE.md §4.5).
 */
export function nameKey(fullName: string): string {
  return fullName.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
