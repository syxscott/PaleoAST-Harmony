/**
 * Exception handler ¡ª replaces app_infrastructure/exception_handler.py
 * Converts technical exceptions to user-friendly messages.
 */

export class ExceptionHandler {
  static handle(error: unknown, context: string = ''): string {
    const msg = error instanceof Error ? error.message : String(error);
    const prefix = context ? context + ': ' : '';
    console.error(prefix + msg);
    return prefix + msg;
  }

  static formatUserError(error: unknown, operation: string = ''): string {
    const msg = error instanceof Error ? error.message : String(error);
    const hint = operation ? operation + ' ' : '';
    if (msg.includes('No data')) return hint + 'No data loaded. Please load data first.';
    if (msg.includes('singular')) return hint + 'Matrix is singular. Check for linear dependencies.';
    if (msg.includes('shape') || msg.includes('dimension')) return hint + 'Dimension mismatch. Check data dimensions.';
    if (msg.includes('NaN') || msg.includes('nan')) return hint + 'Data contains missing values.';
    if (msg.includes('negative')) return hint + 'Data contains negative values.';
    if (msg.includes('empty')) return hint + 'Data is empty.';
    if (msg.includes('convergence')) return hint + 'Algorithm did not converge. Try increasing iterations.';
    if (msg.includes('timeout')) return hint + 'Operation timed out.';
    return hint + 'Error: ' + msg.substring(0, 200);
  }
}
