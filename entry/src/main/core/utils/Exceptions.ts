/**
 * Custom exceptions ¡ª replaces utils/exceptions.py
 */

export class ValidationError extends Error {
  constructor(message: string, public details?: Record<string, unknown>) {
    super(message); this.name = 'ValidationError';
  }
}

export class ComputationError extends Error {
  constructor(message: string, public originalException?: unknown) {
    super(message); this.name = 'ComputationError';
  }
}

export class MatrixDimensionError extends Error {
  constructor(message: string, public details?: Record<string, unknown>) {
    super(message); this.name = 'MatrixDimensionError';
  }
}

export class ConvergenceError extends Error {
  constructor(message: string, public iterations?: number) {
    super(message); this.name = 'ConvergenceError';
  }
}

export class FileOperationError extends Error {
  constructor(message: string, public filepath?: string) {
    super(message); this.name = 'FileOperationError';
  }
}

export class DataFormatError extends Error {
  constructor(message: string, public context?: string) {
    super(message); this.name = 'DataFormatError';
  }
}
