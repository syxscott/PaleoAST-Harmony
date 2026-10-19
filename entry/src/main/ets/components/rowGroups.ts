/**
 * rowGroups — the spreadsheet's group labels, as pure functions.
 *
 * Why this file exists
 * --------------------
 * The spreadsheet keeps one group label per row in its own `@State` array and
 * publishes the WHOLE array to the workspace, which writes it into the
 * DataMatrix (`rowMeta`). That made a stale array dangerous:
 *
 *   1. group some rows of dataset A;
 *   2. load dataset B — the table kept showing A's labels, because the
 *      labels were inherited BY ROW NUMBER (`rowGroups[i] ?? 'Ungrouped'`);
 *   3. click "Set Group" once in B — the whole array, A's labels included,
 *      was written into B.
 *
 * B then inherited A's grouping, and every group-based analysis (ANOSIM /
 * PERMANOVA / SIMPER / LDA) reported a p-value for a grouping that has
 * nothing to do with B — while looking perfectly normal on screen.
 *
 * The rules implemented here:
 *   - a label array always has exactly one entry per row of the CURRENT
 *     table, and a row without a label is 'Ungrouped';
 *   - a new dataset starts from a blank label array (`blankGroups`), it never
 *     inherits the previous one;
 *   - "Set Group" cycles the row through the palette (`cycleGroup`).
 *
 * Plain `.ts` with no ArkUI dependency, so it can be unit tested in Node.
 */

/** The label of a row that belongs to no group. */
export const UNGROUPED: string = 'Ungrouped';

/** A label array for a table with `n` rows and no groups assigned. */
export function blankGroups(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(UNGROUPED);
  return out;
}

/**
 * Fit an existing label array to a table with `n` rows.
 *
 * Rows that have no label become 'Ungrouped'; labels beyond the last row are
 * dropped. The result always has exactly `n` entries, so it can be handed to
 * `DataMatrix.setGroups()` without carrying a previous table's labels into
 * the new one.
 */
export function fitGroups(existing: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const label = existing[i];
    out.push(label === undefined || label === '' ? UNGROUPED : label);
  }
  return out;
}

/**
 * The next group label for a row: the one after the current one in the
 * palette, wrapping around. An unknown label (including 'Ungrouped') starts
 * at the first entry of the palette.
 */
export function cycleGroup(current: string, palette: string[]): string {
  if (palette.length === 0) return UNGROUPED;
  const idx = palette.indexOf(current);
  return palette[(idx + 1) % palette.length];
}
