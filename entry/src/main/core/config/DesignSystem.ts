/**
 * Design system — replaces config/design_system.py (624 lines)
 * Typography, spacing, border radius, and theme definitions.
 */

export const Typography = {
  familyPrimary: "HarmonyOS Sans, system-ui, sans-serif",
  familyMono: "HarmonyOS Sans Mono, Consolas, monospace",
  h1Size: 28, h2Size: 22, h3Size: 18,
  bodySize: 14, bodySmSize: 12, captionSize: 10,
  light: 300, regular: 400, medium: 500, semibold: 600, bold: 700,
};

export const Spacing = {
  xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 24, xxxl: 32,
};

export const BorderRadius = {
  sm: "4px", md: "8px", lg: "12px", xl: "16px", full: "9999px",
};

export interface ThemePalette {
  bgPrimary: string; bgSecondary: string; bgTertiary: string;
  textPrimary: string; textSecondary: string; textDisabled: string;
  primary: string; primaryDark: string; primaryLight: string;
  borderLight: string; borderMedium: string;
  hoverOverlay: string; activeOverlay: string;
  success: string; warning: string; danger: string;
}

export const LIGHT_THEME: ThemePalette = {
  bgPrimary: "#FFFFFF", bgSecondary: "#F8F9FA", bgTertiary: "#ECF0F1",
  textPrimary: "#2C3E50", textSecondary: "#7F8C8D", textDisabled: "#BDC3C7",
  primary: "#3498DB", primaryDark: "#2980B9", primaryLight: "#85C1E9",
  borderLight: "#E4E7EB", borderMedium: "#BDC3C7",
  hoverOverlay: "#00000008", activeOverlay: "#3498DB20",
  success: "#27AE60", warning: "#F39C12", danger: "#E74C3C",
};

export const DARK_THEME: ThemePalette = {
  bgPrimary: "#1a1a2e", bgSecondary: "#16213e", bgTertiary: "#0f3460",
  textPrimary: "#EEEEEE", textSecondary: "#AAAAAA", textDisabled: "#666666",
  primary: "#3498DB", primaryDark: "#2980B9", primaryLight: "#85C1E9",
  borderLight: "#333333", borderMedium: "#555555",
  hoverOverlay: "#ffffff10", activeOverlay: "#3498DB30",
  success: "#2ECC71", warning: "#F1C40F", danger: "#E74C3C",
};

export function getPalette(dark: boolean = false): ThemePalette {
  return dark ? DARK_THEME : LIGHT_THEME;
}
