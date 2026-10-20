/**
 * The sample row a dialog-supplied index refers to.
 *
 * Plain `.ts` with no ArkUI dependency, so the unit suite can cover the
 * clamping. The rule used to live in a private method of `pages/Index.ets`,
 * where no test could reach it.
 */

/**
 * Clamp a dialog-supplied sample row index to the loaded matrix.
 *
 * The index is floored (a row is a whole number), a value that is not a finite
 * number means "the first row", and the result is kept inside the range the
 * loaded matrix actually has.
 *
 * @param raw   the value the dialog published; it may be missing or NaN
 * @param nRows the number of rows of the loaded matrix
 */
export function clampSampleIndex(raw: number, nRows: number): number {
  const idx = Number.isFinite(raw) ? Math.floor(raw) : 0;
  return Math.min(Math.max(idx, 0), Math.max(0, nRows - 1));
}
