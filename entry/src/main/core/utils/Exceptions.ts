export class ValidationError extends Error { constructor(msg: string, public details?: Record<string, unknown>) { super(msg); this.name = "ValidationError"; } }
export class ComputationError extends Error { constructor(msg: string, public original?: unknown) { super(msg); this.name = "ComputationError"; } }
export class MatrixDimensionError extends Error { constructor(msg: string, public details?: Record<string, unknown>) { super(msg); this.name = "MatrixDimensionError"; } }
export class ConvergenceError extends Error { constructor(msg: string, public iterations?: number) { super(msg); this.name = "ConvergenceError"; } }
export class FileOperationError extends Error { constructor(msg: string, public filepath?: string) { super(msg); this.name = "FileOperationError"; } }
export class DataFormatError extends Error { constructor(msg: string, public context?: string) { super(msg); this.name = "DataFormatError"; } }
