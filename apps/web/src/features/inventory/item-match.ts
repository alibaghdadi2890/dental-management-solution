import type { StockRow } from '@dcm/contracts';

/** Matches a name or a code at once, case and accents aside (C1). */
export function matchesItem(row: Pick<StockRow, 'name' | 'code'>, query: string): boolean {
  const fold = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase();
  const wanted = fold(query.trim());
  return wanted === '' || fold(row.name).includes(wanted) || fold(row.code ?? '').includes(wanted);
}
