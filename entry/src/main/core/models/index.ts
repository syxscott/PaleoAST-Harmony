export { DataMatrix, DataMatrixView } from "./DataMatrix";
export {
  ColumnMetadata,
  type ColumnMeta,
  type ColumnDataType
} from "./ColumnMetadata";
export {
  RowMetadata,
  type RowMeta
} from "./RowMetadata";
export {
  StateManager,
  getStateManager
} from "./StateManager";
export * from "./ResultTypes";
export {
  type DiversityIndexResult,
  type DiversityResult as DiversityRecord
} from "./DiversityResult";

// ─── Convenience type aliases matching Python's models/diversity_result.py ─────
export { type PCAResult } from "./ResultTypes";
