/**
 * Application constants — replaces config/constants.py (347 lines)
 * All magic numbers and configuration values.
 */

// Analysis Defaults
export const PERMUTATION_TESTS = 999;
export const NMDS_MAX_ITERATIONS = 300;
export const NMDS_RANDOM_RESTARTS = 10;
export const NMDS_TOLERANCE = 1e-6;
export const PCA_MAX_COMPONENTS = 20;
export const CLUSTERING_MAX_CLUSTERS = 20;
export const CONISS_DEFAULT_ZONES = 4;
export const MARKOV_DEFAULT_BINS = 10;
export const SPECTRAL_CONFIDENCE_LEVEL = 0.95;
export const WAVELET_DEFAULT_SCALES = 30;
export const BIOSTRAT_MIN_OCCURRENCE = 2;
export const GPA_MAX_ITERATIONS = 100;
export const GPA_TOLERANCE = 1e-8;
export const EFA_MAX_HARMONICS = 20;
export const FBD_MAX_EVENTS = 100000;

// Display
export const PLOT_DPI_SCREEN = 100;
export const PLOT_DPI_PRINT = 300;
export const PLOT_DPI_HIGH = 600;
export const PLOT_DEFAULT_WIDTH = 800;
export const PLOT_DEFAULT_HEIGHT = 600;
export const SPREADSHEET_MAX_ROWS = 10000;
export const SPREADSHEET_MAX_COLS = 1000;
export const MAX_RESULT_HISTORY = 8;

// Numerical
export const EPSILON = 1e-10;
export const MAX_ITERATIONS_DEFAULT = 100;
export const CONVERGENCE_TOLERANCE = 1e-8;
export const SVD_THRESHOLD = 1e-14;
export const MATRIX_SINGULAR_THRESHOLD = 1e-15;

// File I/O
export const SUPPORTED_CSV_EXTENSIONS = ["csv", "tsv", "txt"];
export const SUPPORTED_TREE_EXTENSIONS = ["tre", "tree", "nwck", "newick"];
export const SUPPORTED_NEXUS_EXTENSIONS = ["nxs", "nex"];
export const SUPPORTED_TPS_EXTENSIONS = ["tps"];
export const SUPPORTED_EXCEL_EXTENSIONS = ["xlsx", "xls"];
export const NA_VALUES = ["NA", "NaN", "-", "", "nan", "null", "N/A", "n/a", "."];

// UI
export const RIBBON_HEIGHT = 130;
export const NAVIGATION_WIDTH = 220;
export const STATUS_BAR_HEIGHT = 28;
export const DIALOG_WIDTH = 450;
export const TOOLBAR_HEIGHT = 36;
export const CELL_WIDTH = 80;
export const ROW_LABEL_WIDTH = 40;
