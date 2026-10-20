/**
 * cellAppearance — how the spreadsheet draws a cell, as pure functions.
 *
 * Why this file exists
 * --------------------
 * The row of the data table is a separate `@Reusable` component
 * (`SpreadsheetRow.ets`), so the rules that decide what a cell looks like
 * have to live somewhere both the row and the status bar can reach. They
 * used to be private methods of `Spreadsheet`, which the row could not call.
 *
 * Copying them into the row instead would have produced a second
 * implementation of the same four rules — and the two would drift: the row
 * would show a selected cell in one colour while the status bar reported
 * another. So the rules are extracted here, once, and imported by both.
 *
 * The functions are plain TypeScript with no ArkUI dependency, so the unit
 * test suite can check the colours and the text directly (the .ets layer
 * cannot run under Node at all).
 */
import { token } from '../theme/tokens';

/**
 * The text of a cell.
 *
 * A missing value is 'NA', an infinite one '+Inf' / '-Inf', a small or a
 * huge one is written in exponential notation, and everything else gets
 * four decimals.
 *
 * @param value the value in the table
 * @returns the text to show in the cell
 */
export function formatCell(value: number): string {
  if (isNaN(value)) return 'NA';
  if (!isFinite(value)) return value > 0 ? '+Inf' : '-Inf';
  if (Number.isInteger(value) && Math.abs(value) < 1e10) return value.toString();
  if (Math.abs(value) < 0.001 || Math.abs(value) >= 1e6) return value.toExponential(3);
  return value.toFixed(4);
}

/**
 * The text colour of a cell: red for a missing value, amber for a negative
 * one, the ordinary text colour otherwise.
 *
 * @param value the value in the table
 * @param dark true for the dark theme
 * @returns the colour to write the cell's text in
 */
export function cellFontColor(value: number, dark: boolean): string {
  if (isNaN(value)) return token('danger', dark);
  if (value < 0) return token('warning', dark);
  return token('text_primary', dark);
}

/**
 * The background of a cell.
 *
 * The cell the user clicked wins over the row it is in, the row wins over
 * the column, and a cell that is in neither is transparent.
 *
 * @param row the row of the cell
 * @param col the column of the cell
 * @param selectedRow the row the user has selected, or -1
 * @param selectedCol the column the user has selected, or -1
 * @param dark true for the dark theme
 * @returns the background colour of the cell
 */
export function cellBackground(row: number, col: number, selectedRow: number, selectedCol: number, dark: boolean): string {
  if (row === selectedRow && col === selectedCol) return token('cell_selected', dark);
  if (row === selectedRow) return token('bg_tint', dark);
  if (col === selectedCol) return token('bg_selected', dark);
  return 'transparent';
}

/**
 * The background of a whole row: the selected row is tinted, every second
 * row carries the faint stripe.
 *
 * @param row the row
 * @param selectedRow the row the user has selected, or -1
 * @param dark true for the dark theme
 * @returns the background colour of the row
 */
export function rowBackground(row: number, selectedRow: number, dark: boolean): string {
  if (row === selectedRow) return token('bg_tint', dark);
  return row % 2 === 0 ? 'transparent' : token('row_stripe', dark);
}
