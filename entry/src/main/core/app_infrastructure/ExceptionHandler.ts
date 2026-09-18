/**
 * Exception handler �� replaces app_infrastructure/exception_handler.py
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

// ─── Global exception handling (exception_handler.py + crash_report) ────────

export interface ExceptionInfo {
  message: string;
  stack: string;
  timestamp: number;
  context: string;
}

export interface CrashReport {
  exceptions: ExceptionInfo[];
  systemInfo: Record<string, string>;
}

/** Collects uncaught errors and produces shareable crash reports. */
export class GlobalExceptionHandler {
  private static _i: GlobalExceptionHandler | null = null;
  private exceptions: ExceptionInfo[] = [];
  private readonly maxExceptions = 50;
  private installed = false;

  static getInstance(): GlobalExceptionHandler {
    if (!GlobalExceptionHandler._i) GlobalExceptionHandler._i = new GlobalExceptionHandler();
    return GlobalExceptionHandler._i;
  }

  /**
   * Install a global JS-error hook. Uses @kit.AbilityKit errorManager when
   * available (device); in environments without it (tests/preview) this is a
   * monitored no-op — manual `report()` still works.
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    void (async (): Promise<void> => {
      try {
        const kit = await import('@kit.AbilityKit');
        kit.errorManager.on('error', (err: Error) => {
          this.report(err, 'uncaught');
        });
      } catch (e) {
        // platform without errorManager — manual reporting still available
      }
    })();
  }

  /** Record an exception into the crash log. */
  report(error: unknown, context: string = ''): ExceptionInfo {
    const info: ExceptionInfo = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? (error.stack ?? '') : '',
      timestamp: Date.now(),
      context,
    };
    this.exceptions.push(info);
    if (this.exceptions.length > this.maxExceptions) this.exceptions.shift();
    ExceptionHandler.handle(error, context);
    return info;
  }

  /** Recent exceptions for diagnostics. */
  getExceptions(): ExceptionInfo[] {
    return [...this.exceptions];
  }

  /** Assemble a shareable crash report (exception_handler.py CrashReport). */
  buildCrashReport(): CrashReport {
    const systemInfo: Record<string, string> = {
      platform: 'HarmonyOS',
      timestamp: new Date().toISOString(),
      exceptionCount: String(this.exceptions.length),
    };
    return { exceptions: [...this.exceptions], systemInfo };
  }

  /** Render the crash report as readable text (for export/share). */
  formatCrashReport(): string {
    const r = this.buildCrashReport();
    const lines = [
      '=== PaleoAST Crash Report ===',
      `Platform: ${r.systemInfo.platform}`,
      `Generated: ${r.systemInfo.timestamp}`,
      `Exceptions: ${r.systemInfo.exceptionCount}`,
      '',
    ];
    for (const e of r.exceptions.slice(-10)) {
      lines.push(`[${new Date(e.timestamp).toISOString()}] (${e.context}) ${e.message}`);
      if (e.stack) lines.push(e.stack.split('\n').slice(0, 4).join('\n'));
      lines.push('');
    }
    return lines.join('\n');
  }

  clear(): void { this.exceptions = []; }
}

/** Install the global handler (exception_handler.py install_global_exception_handler). */
export function installGlobalExceptionHandler(): GlobalExceptionHandler {
  const h = GlobalExceptionHandler.getInstance();
  h.install();
  return h;
}

export function getGlobalExceptionHandler(): GlobalExceptionHandler {
  return GlobalExceptionHandler.getInstance();
}

/** Lightweight system info snapshot (exception_handler.py SystemInfoCollector). */
export function collectSystemInfo(): Record<string, string> {
  return {
    platform: 'HarmonyOS',
    timestamp: new Date().toISOString(),
  };
}
