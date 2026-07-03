/**
 * Custom exceptions — replaces utils/exceptions.py (13 classes).
 *
 * All exceptions inherit from PaleoASTError so callers may catch generically.
 */

export class PaleoASTError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaleoASTError';
  }
}

export class ValidationError extends PaleoASTError {
  constructor(message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class DataValidationError extends ValidationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = 'DataValidationError';
  }
}

export class MatrixDimensionError extends PaleoASTError {
  constructor(message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = 'MatrixDimensionError';
  }
}

export class ConvergenceError extends PaleoASTError {
  constructor(message: string, public iterations?: number) {
    super(message);
    this.name = 'ConvergenceError';
  }
}

export class InvalidDataTypeError extends PaleoASTError {
  constructor(message: string, public received?: unknown) {
    super(message);
    this.name = 'InvalidDataTypeError';
  }
}

export class FileFormatError extends PaleoASTError {
  constructor(message: string, public path?: string) {
    super(message);
    this.name = 'FileFormatError';
  }
}

export class FileOperationError extends PaleoASTError {
  constructor(message: string, public filepath?: string) {
    super(message);
    this.name = 'FileOperationError';
  }
}

export class ComputationError extends PaleoASTError {
  constructor(message: string, public originalException?: unknown) {
    super(message);
    this.name = 'ComputationError';
  }
}

export class StatisticalError extends ComputationError {
  constructor(message: string, originalException?: unknown) {
    super(message, originalException);
    this.name = 'StatisticalError';
  }
}

export class MorphometricsError extends ComputationError {
  constructor(message: string, originalException?: unknown) {
    super(message, originalException);
    this.name = 'MorphometricsError';
  }
}

export class PlottingError extends PaleoASTError {
  constructor(message: string, public chartName?: string) {
    super(message);
    this.name = 'PlottingError';
  }
}

export class DataFormatError extends FileFormatError {
  constructor(message: string, public context?: string) {
    super(message);
    this.name = 'DataFormatError';
  }
}
