export interface Plugin {
  name: string;
  version: string;
  description: string;
  author: string;
  analyze: (data: number[][], params: Record<string, unknown>) => unknown;
}

export abstract class BasePlugin implements Plugin {
  abstract name: string;
  abstract version: string;
  abstract description: string;
  abstract author: string;
  abstract analyze(data: number[][], params: Record<string, unknown>): unknown;

  getInfo(): string {
    return this.name + ' v' + this.version + ' by ' + this.author;
  }
}

// ─── Analysis plugin API (plugins/base.py AnalysisPlugin/AnalysisResult) ────

/** Standard result shape returned by analysis plugins. */
export interface AnalysisResult {
  pluginName: string;
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
}

/**
 * Analysis-oriented plugin base: subclasses declare metadata + a run() body
 * and get execute() bookkeeping (timing + result wrapping) for free.
 */
export abstract class AnalysisPlugin extends BasePlugin {
  abstract run(data: number[][], params: Record<string, unknown>): unknown;

  /** Wrapped execution with timing and error capture. */
  execute(data: number[][], params: Record<string, unknown> = {}): AnalysisResult {
    const start = Date.now();
    try {
      const out = this.run(data, params);
      return { pluginName: this.name, success: true, data: out, durationMs: Date.now() - start };
    } catch (e) {
      return {
        pluginName: this.name, success: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      };
    }
  }
}
