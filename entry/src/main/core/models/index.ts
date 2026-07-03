export { DataMatrix, DataMatrixView } from "./DataMatrix";
export {
  ColumnMetadata,
  ColumnMetadataManager,
  ColumnMeta,
  ColumnDataType
} from "./ColumnMetadata";
export {
  RowMetadata,
  RowMetadataManager,
  RowMeta
} from "./RowMetadata";
export {
  StateManager,
  getStateManager
} from "./StateManager";
export * from "./ResultTypes";
export {
  DiversityIndexResult,
  DiversityResult as DiversityRecord
} from "./DiversityResult";

// ─── Convenience type aliases matching Python's models/diversity_result.py ─────
export { type PCAResult } from "./ResultTypes";
