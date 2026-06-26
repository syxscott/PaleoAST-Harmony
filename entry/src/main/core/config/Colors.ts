/**
 * Color schemes — replaces config/colors.py
 * All color palettes for charts, UI, and scientific visualization.
 */

// ─── Chart Color Schemes ─────────────────────────────────────────

export const CHART_COLORS: string[] = [
  '#3498DB', '#E74C3C', '#27AE60', '#F39C12', '#9B59B6',
  '#1ABC9C', '#E67E22', '#34495E', '#95A5A6', '#D35400',
  '#8E44AD', '#16A085', '#C0392B', '#2980B9', '#F1C40F',
];

export const COLORBLIND_FRIENDLY: string[] = [
  '#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00',
  '#56B4E9', '#F0E442', '#000000',
];

export const IBM_COLORBLIND_SAFE: string[] = [
  '#648FFF', '#FE6100', '#DC267F', '#FFB000', '#785EF0',
];

export const DIVERGING_COLORS: string[] = [
  '#2166AC', '#4393C3', '#92C5DE', '#D1E5F0',
  '#FDDBC7', '#F4A582', '#D6604D', '#B2182B',
];

export const SEQUENTIAL_COLORS: string[] = [
  '#F7FBFF', '#DEEBF7', '#C6DBEF', '#9ECAE1',
  '#6BAED6', '#4292C6', '#2171B5', '#084594',
];

// ─── UI Colors ───────────────────────────────────────────────────

export const UI_COLORS = {
  primary: '#3498DB',
  primaryDark: '#2980B9',
  primaryLight: '#85C1E9',
  success: '#27AE60',
  warning: '#F39C12',
  danger: '#E74C3C',
  info: '#3498DB',
  dark: '#2C3E50',
  light: '#ECF0F1',
};

// ─── Color Scheme Registry ───────────────────────────────────────

const SCHEMES: Record<string, string[]> = {
  default: CHART_COLORS,
  colorblind: COLORBLIND_FRIENDLY,
  ibm: IBM_COLORBLIND_SAFE,
  diverging: DIVERGING_COLORS,
  sequential: SEQUENTIAL_COLORS,
};

export function getColorScheme(name: string = 'default'): string[] {
  return SCHEMES[name] ?? CHART_COLORS;
}

export function getColor(index: number, scheme: string = 'default'): string {
  const colors = getColorScheme(scheme);
  return colors[index % colors.length];
}
