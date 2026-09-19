/**
 * ValueFormatter — pluggable numeric formatting for axis labels and tooltips.
 *
 * Axis ticks, bar labels, tooltips and the SVG export each used to call
 * `.toFixed(2)` inline, so a plot with axis values of 1e-6 or 1.2e5 produced
 * unusable labels ("0.00") and the decimal count could not be changed anywhere.
 *
 * The interface mirrors what a charting library exposes so a caller can swap in
 * a domain formatter (percentages, ages in Ma, species counts) without touching
 * the renderer.
 */

export interface IValueFormatter {
  format(value: number): string;
}

/** Fixed decimal places — the default and the previous behaviour. */
export class DigitsFormatter implements IValueFormatter {
  private digits: number;

  constructor(digits: number = 2) {
    this.digits = Math.max(0, Math.min(12, digits));
  }

  format(value: number): string {
    if (!isFinite(value)) {
      return String(value);
    }
    return value.toFixed(this.digits);
  }
}

/**
 * Adaptive precision: chooses the decimal count from the magnitude of the value
 * so small and large numbers both stay readable.
 */
export class AdaptiveFormatter implements IValueFormatter {
  format(value: number): string {
    if (!isFinite(value)) {
      return String(value);
    }
    const abs = Math.abs(value);
    if (abs === 0) {
      return '0';
    }
    if (abs >= 1e5 || abs < 1e-4) {
      return value.toExponential(2);
    }
    if (abs >= 100) {
      return value.toFixed(1);
    }
    if (abs >= 1) {
      return value.toFixed(2);
    }
    return value.toFixed(Math.min(6, 2 + Math.ceil(-Math.log10(abs))));
  }
}

/** Whole numbers with thousands separators — useful for counts. */
export class IntegerFormatter implements IValueFormatter {
  format(value: number): string {
    if (!isFinite(value)) {
      return String(value);
    }
    return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
}

/**
 * Pick a sensible formatter for a data range when the caller has no preference:
 * adaptive when the span is wide or tiny, fixed decimals otherwise.
 */
export function autoFormatter(span: number, digits: number = 2): IValueFormatter {
  if (!isFinite(span) || span <= 0) {
    return new DigitsFormatter(digits);
  }
  const order = Math.floor(Math.log10(span));
  if (order <= -3 || order >= 5) {
    return new AdaptiveFormatter();
  }
  return new DigitsFormatter(digits);
}
