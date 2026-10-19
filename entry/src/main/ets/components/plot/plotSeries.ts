/**
 * plotSeries — "what does this analysis plot?", decided in exactly one place.
 *
 * Why this file exists
 * --------------------
 * The chart of a dialog-routed analysis used to be decided by
 * `firstNumericSeries()` in `Index.ets`, which returned "the first numeric
 * array in the result object, in key order". That has nothing to do with what
 * the analysis computed:
 *
 *   - a rarefaction result is `{ sampleName, sampleSizes, expectedTaxa, … }`,
 *     so the chart was `sampleSizes` — the straight line 1, 3, 5, 7, 9 — and
 *     the dilution curve (`expectedTaxa`) was never drawn;
 *   - a periodogram result is `{ frequencies, periods, power, … }`, so the
 *     chart was `frequencies` — another straight line — and the power
 *     spectrum was never drawn;
 *   - a diversity result is all scalars, so nothing was drawn at all.
 *
 * The three analyses that DO have a dedicated drawing branch lived in the
 * other switch of the same method, where the first switch had already opened
 * their dialog and returned: those branches were unreachable.
 *
 * The rules implemented here
 * -------------------------
 *  1. One decision per analysis. The table below covers the analyses whose
 *     result shape is known; everything else goes through the generic
 *     fallback below. Either way the answer comes from here, never from a
 *     second copy in the component.
 *
 *  2. A field that carries coordinates, an index or a label is NEVER the
 *     interpreted variable. Those names are listed in `AXIS_ONLY_FIELDS` and
 *     may only be used as the X axis.
 *
 *  3. When the X axis cannot be determined, NO chart is produced. A made-up
 *     X (the sample index) turns "unexplained" into "wrong", and these
 *     figures end up in papers.
 *
 * Plain `.ts` with no ArkUI dependency, so it can be unit tested in Node —
 * the same reason `ViewPortHandler` / `ChartComputator` live in this folder.
 */

/** The chart the canvas is asked to draw. */
export interface PlotSelection {
  /** X values — the independent variable. */
  x: number[];
  /** Y values — the interpreted variable. */
  y: number[];
  /** Plot type: 'line' | 'scatter' | 'bar' | 'histogram' | 'none'. */
  type: string;
  /** Title for the chart; '' means "keep the analysis name". */
  title: string;
}

/**
 * Fields that carry a coordinate, an index or a label.
 *
 * They are the X axis of a chart, never its Y: `sampleSizes` is how many
 * individuals were drawn, `frequencies`/`periods` locate a spectral peak,
 * `classLabels`/`groups` name the specimens. Plotting one of them as the
 * response produces a line that looks like a result and is not one.
 */
export const AXIS_ONLY_FIELDS: string[] = [
  'sampleSizes', 'frequencies', 'periods', 'times', 'ages', 'depths', 'heights',
  'sampleName', 'sampleNames', 'rowLabels', 'colLabels', 'labels', 'indices',
  'taxa', 'counts', 'classLabels', 'groups', 'faciesNames', 'depthLabels',
  'zoneAssignments', 'nLayersAbove', 'peakValues', 'depth',
];

/**
 * Fields that are known to be the interpreted variable, in priority order.
 *
 * The list is only a hint: the generic fallback still scans the result for a
 * numeric array that is not an axis-only field.
 */
export const RESPONSE_FIELDS: string[] = [
  'values', 'expectedTaxa', 'expectedRichness', 'power', 'amplitudes',
  'coefficients', 'axis1Scores', 'centroidSizes', 'procrustesDistances',
  'ladPositions', 'eigenvalues', 'proportionExplained', 'survivorship',
  'rates', 'permutationScores', 'simulatedScores', 'series',
];

/** Per-analysis drawing recipe. */
interface SeriesSpec {
  /** Candidate Y fields, in priority order. */
  y: string[];
  /** Candidate X fields, in priority order. */
  x: string[];
  /** Chart type. */
  type: string;
  /** The result holds scalars only — there is nothing to plot, by design. */
  scalar?: boolean;
}

/**
 * The analyses whose result shape is known.
 *
 * `x` lists the coordinate field of that analysis, not a generic guess:
 * a rarefaction is drawn against the number of individuals drawn, a
 * periodogram against the period.
 */
const SPECS: Record<string, SeriesSpec> = {
  'Rarefaction': { y: ['expectedTaxa'], x: ['sampleSizes'], type: 'line' },
  'Spectral': { y: ['power'], x: ['periods', 'frequencies'], type: 'line' },
  'Isotope': { y: ['values'], x: ['depths'], type: 'line' },
  'Paleo-Environment': { y: ['axis1Scores'], x: ['heights'], type: 'line' },
  'Diversity Indices': { y: [], x: [], type: 'none', scalar: true },
};

/** A Matrix-like value: the ordination results carry one. */
interface MatrixLike {
  col(index: number): number[];
}

/** True when the field name is a coordinate / index / label field. */
export function isAxisOnlyField(name: string): boolean {
  return AXIS_ONLY_FIELDS.indexOf(name) >= 0;
}

/** Format a possibly-missing number for a chart title. */
function numText(v: Object | undefined, digits?: number): string {
  if (typeof v !== 'number') return 'n/a';
  const n = v as number;
  if (!isFinite(n)) return 'n/a';
  return digits === undefined ? String(n) : n.toFixed(digits);
}

/**
 * Title for the chart.
 *
 * The numbers that matter are in the title, because an analysis without a
 * plottable series still has to report its result somewhere the user sees.
 */
function titleFor(analysis: string, r: Record<string, Object>): string {
  if (analysis === 'Diversity Indices') {
    return 'Diversity: S=' + numText(r['richness']) + ' H=' + numText(r['shannon'], 2);
  }
  if (analysis === 'Spectral') {
    return 'Spectral (peak=' + numText(r['peakPeriod'], 2) + ')';
  }
  if (analysis === 'Rarefaction') return 'Rarefaction Curve';
  if (analysis === 'LDA') return 'LDA Score Plot';
  return '';
}

/** The first of `names` that is a plain numeric array (optionally of a given length). */
function pickSeries(r: Record<string, Object>, names: string[], requiredLength?: number): number[] | null {
  for (const name of names) {
    const v = r[name];
    if (!Array.isArray(v)) continue;
    const arr = v as number[];
    if (arr.length < 2) continue;
    if (typeof arr[0] !== 'number') continue;
    if (requiredLength !== undefined && arr.length !== requiredLength) continue;
    return arr;
  }
  return null;
}

/**
 * The first plain numeric array of the result, in key order.
 *
 * `includeAxisFields` decides whether coordinate / label fields may be
 * returned — they may be the X axis, never the response.
 */
function pickNumericArray(r: Record<string, Object>, includeAxisFields: boolean): number[] | null {
  for (const key of Object.keys(r)) {
    if (!includeAxisFields && isAxisOnlyField(key)) continue;
    const v = r[key];
    if (!Array.isArray(v)) continue;
    const arr = v as number[];
    if (arr.length < 2) continue;
    if (typeof arr[0] !== 'number') continue;
    return arr;
  }
  return null;
}

/**
 * The first two axes of an ordination, if the result carries one.
 *
 * `scores` / `coordinates` are Matrix instances in the core (they expose
 * `col(i)`), and plain `[x, y]` pairs in a few results.
 */
function pickScatterPairs(r: Record<string, Object>): number[][] | null {
  for (const key of ['scores', 'coordinates']) {
    const v = r[key];
    if (v === undefined || v === null) continue;
    const m = v as MatrixLike;
    if (typeof m.col === 'function') {
      const c0 = m.col(0);
      const c1 = m.col(1);
      if (c0.length > 1 && c0.length === c1.length) return [c0, c1];
      continue;
    }
    const pairs = v as number[][];
    if (Array.isArray(pairs) && pairs.length > 1 && Array.isArray(pairs[0])) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const p of pairs) {
        xs.push(p[0]);
        ys.push(p[1]);
      }
      return [xs, ys];
    }
  }
  return null;
}

/** An empty selection: nothing to plot, and the canvas must be cleared. */
function emptySelection(title: string): PlotSelection {
  return { x: [], y: [], type: 'none', title: title };
}

/**
 * Pick the series a result should be drawn as.
 *
 * @param analysis the analysis name, as the workspace knows it.
 * @param result   the analysis result (any object the core returned).
 */
export function selectPlotSeries(analysis: string, result: Object | null | undefined): PlotSelection {
  if (result === null || result === undefined || typeof result !== 'object') {
    return emptySelection('');
  }
  const r = result as Record<string, Object>;
  const title = titleFor(analysis, r);
  const spec = SPECS[analysis];

  if (spec) {
    if (spec.scalar) return emptySelection(title);
    let y = pickSeries(r, spec.y);
    if (!y) y = pickNumericArray(r, false);
    if (!y) return emptySelection(title);
    const x = pickSeries(r, spec.x, y.length) ?? pickSeries(r, AXIS_ONLY_FIELDS, y.length);
    // No coordinate for this response: no chart. A made-up X axis would be a
    // figure that cannot mean what its title says.
    if (!x) return emptySelection(title);
    return { x: x, y: y, type: spec.type, title: title };
  }

  // An ordination result is a score plot, whatever the analysis is called.
  const pairs = pickScatterPairs(r);
  if (pairs) {
    return { x: pairs[0], y: pairs[1], type: 'scatter', title: title };
  }

  const y = pickSeries(r, RESPONSE_FIELDS) ?? pickNumericArray(r, false);
  if (!y) return emptySelection(title);
  const x = pickSeries(r, AXIS_ONLY_FIELDS, y.length);
  if (!x) return emptySelection(title);
  return { x: x, y: y, type: 'line', title: title };
}
