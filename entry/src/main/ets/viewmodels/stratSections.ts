/**
 * The two measured sections the "Stratigraphic Correlation" analysis works on.
 *
 * Plain `.ts` with no ArkUI dependency, so the unit suite can cover the rule --
 * the same reason `components/plot/plotSeries.ts` and `utils/dataFingerprint.ts`
 * are plain modules rather than part of a component. Before this file existed
 * the rule lived in a private method of `pages/Index.ets`, where no test could
 * reach it: the ArkUI layer cannot execute under the Node harness.
 *
 * The rule itself is unchanged:
 *
 *   - S1 compares the heights (column 0) with the values of column 1;
 *   - S2 compares the heights with the values of column 2, or with the LAST
 *     column when the table has fewer than three columns;
 *   - a column with no rows at all becomes [0], so the correlation has a series
 *     to work with instead of a zero-length one.
 *
 * The type-only import of `Matrix` is erased at runtime, so this module has no
 * dependency of its own -- not even on the core.
 */
import type { Matrix } from '../../core/math/Matrix';

/** One measured section: a height series and the values measured on it. */
export interface StratSection {
  /** The section name: 'S1' or 'S2'. */
  name: string;
  /** The heights, always taken from the first column. */
  heights: number[];
  /** The values measured at those heights. */
  values: number[];
}

/**
 * Build the two sections of the stratigraphic correlation.
 *
 * @param data the loaded matrix; null means "no data loaded", which yields no
 *             sections at all rather than a section of zeroes.
 */
export function buildStratSections(data: Matrix | null): StratSection[] {
  if (!data) return [];
  const safe = (colIdx: number): number[] => {
    const c = data.col(colIdx);
    return c.length === 0 ? [0] : c;
  };
  return [{
    name: 'S1', heights: data.col(0), values: safe(1),
  }, {
    name: 'S2', heights: data.col(0), values: safe(Math.min(2, data.cols - 1)),
  }];
}
