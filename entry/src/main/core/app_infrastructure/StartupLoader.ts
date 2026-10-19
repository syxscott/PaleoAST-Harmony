/**
 * Startup loader — port of app_infrastructure/startup/loader.py.
 *
 * Runs a table of warm-up modules in dependency order with progress callbacks
 * and cancellation support. In the Python original the modules import heavy
 * scientific libraries; in the ArkTS port a module warm-up is a lightweight
 * self-check function (call a core API once so JIT/imports settle).
 */

export type StartupPhase = 'idle' | 'loading' | 'ready' | 'failed';

export interface StartupProgress {
  phase: StartupPhase;
  /** 0..100 */
  percent: number;
  currentModule: string;
  completedModules: string[];
  error: string | null;
}

export interface StartupModule {
  id: string;
  /** Human-readable label shown by the splash screen. */
  label: string;
  /** Higher weight = larger share of the progress bar. */
  weight: number;
  /** Module ids that must complete before this one starts. */
  dependencies: string[];
  /** Warm-up body. Return value is ignored; throw to fail the startup. */
  load: () => void | Promise<void>;
}

export class StartupLoader {
  private modules: StartupModule[] = [];
  private completed: Set<string> = new Set();
  private cancelled = false;

  /** Register a module. */
  add(module: StartupModule): this {
    this.modules.push(module);
    return this;
  }

  registerBatch(modules: StartupModule[]): this {
    for (const m of modules) this.add(m);
    return this;
  }

  cancel(): void { this.cancelled = true; }

  /**
   * Load all modules respecting dependencies (topological order via repeated
   * passes). `onProgress` fires after every module completes.
   */
  async load(onProgress?: (p: StartupProgress) => void): Promise<boolean> {
    this.cancelled = false;
    this.completed.clear();
    const done: string[] = [];
    const totalWeight = this.modules.reduce((s, m) => s + Math.max(1, m.weight), 0);
    let loadedWeight = 0;

    const report = (current: string, error: string | null): void => {
      onProgress?.({
        phase: error ? 'failed' : (done.length === this.modules.length ? 'ready' : 'loading'),
        percent: Math.min(100, Math.round((loadedWeight / totalWeight) * 100)),
        currentModule: current,
        completedModules: [...done],
        error,
      });
    };

    report('', null);

    const pending = new Set(this.modules.map(m => m.id));
    const byId = new Map(this.modules.map(m => [m.id, m]));
    // dependency-aware passes; at most modules.length passes
    for (let pass = 0; pass <= this.modules.length && pending.size > 0; pass++) {
      let progressed = false;
      for (const id of Array.from(pending)) {
        if (this.cancelled) return false;
        const m = byId.get(id)!;
        if (!m.dependencies.every(d => this.completed.has(d))) continue;
        try {
          await m.load();
          this.completed.add(id);
          pending.delete(id);
          done.push(m.label);
          loadedWeight += Math.max(1, m.weight);
          report(m.label, null);
          progressed = true;
        } catch (e) {
          report(m.label, String(e));
          return false;
        }
      }
      if (!progressed) {
        // dependency cycle or missing dependency
        report([...pending][0] ?? '', 'Unresolvable module dependencies: ' + [...pending].join(', '));
        return false;
      }
    }
    return true;
  }

  getCompleted(): string[] {
    return [...this.completed];
  }
}

/**
 * Default PaleoAST warm-up table (loader.py PaleoASTLoader) — real self-checks.
 *
 * Every entry below runs an ACTUAL function of the module it names and
 * checks the result. Four of the entries used to be empty stubs
 * (`load: () => { void 0; }`) that reported success without warming
 * anything up — a module shown as "loaded" in the splash screen that had
 * never been executed.
 */
export function createPaleoastStartupLoader(): StartupLoader {
  return new StartupLoader().registerBatch([
    {
      id: 'math', label: 'Math libraries', weight: 2, dependencies: [],
      load: () => {
        // 真实自检：触发 linalg 路径（JIT 预热 + 数值栈验证）
        const { Matrix } = require_matrix();
        const m = Matrix.from2D([[2, 1], [1, 3]]);
        if (Math.abs(m.get(0, 0) - 2) > 1e-12) throw new Error('Matrix self-check failed');
      },
    },
    {
      id: 'statistics', label: 'Statistical analyses', weight: 3, dependencies: ['math'],
      load: () => {
        const { mean } = require_stats();
        if (Math.abs(mean([1, 2, 3]) - 2) > 1e-12) throw new Error('stats self-check failed');
      },
    },
    {
      id: 'stratigraphy', label: 'Stratigraphy analyses', weight: 2, dependencies: ['math'],
      load: () => {
        // Real warm-up: run a stratigraphy function and check the number.
        const sm = require_strat().movingAverage([1, 2, 3, 4, 5], 3);
        if (!Array.isArray(sm) || sm.length !== 5 || Math.abs(sm[2] - 3) > 1e-12) {
          throw new Error('stratigraphy self-check failed');
        }
      },
    },
    {
      id: 'morphometrics', label: 'Morphometrics', weight: 2, dependencies: ['math'],
      load: () => {
        // Real warm-up: fit two elliptic Fourier harmonics to a unit circle.
        const contour: number[][] = [];
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * 2 * Math.PI;
          contour.push([Math.cos(a), Math.sin(a)]);
        }
        const r = require_morpho().efa(contour, 2, 16);
        if (!r || !Array.isArray(r.reconstructed) || r.reconstructed.length !== 16) {
          throw new Error('morphometrics self-check failed');
        }
      },
    },
    {
      id: 'phylogenetics', label: 'Phylogenetics', weight: 2, dependencies: ['math'],
      load: () => {
        // Real warm-up: parse a Newick tree and count its tips.
        const tree = require_phylo().parseNewick('(A,B,(C,D));');
        if (!tree || tree.getLeaves().length !== 4) {
          throw new Error('phylogenetics self-check failed');
        }
      },
    },
    {
      id: 'native', label: 'Native acceleration', weight: 1, dependencies: ['math'],
      // The promise is AWAITED. It used to be discarded
      // (`void initNative().catch(...)`), so a native warm-up that failed
      // could never be reported: the startup announced "ready" either way.
      // `initNative()` resolves FALSE when the .so is unavailable — that is
      // the documented pure-TS fallback, not a failure — but a rejection now
      // stops the startup and is reported through `StartupProgress.error`.
      load: (): Promise<void> => _startupInitNative().then(() => undefined),
    },
    {
      id: 'plugins', label: 'Plugins', weight: 1, dependencies: ['statistics'],
      load: () => {
        // Real warm-up: exercise the plugin registry end to end. The registry
        // is a global singleton, so the probe plugin is removed again before
        // the warm-up returns.
        const registry = require_plugins();
        const probe: Plugin = {
          name: '__startup_probe__', version: '0.0.0',
          description: 'startup self-check', author: 'paleoast',
          analyze: (_data: number[][], _params: Record<string, unknown>): unknown => null,
        };
        registry.register(probe);
        const found = registry.get('__startup_probe__');
        registry.remove('__startup_probe__');
        if (found !== probe) throw new Error('plugin registry self-check failed');
      },
    },
  ]);
}

// Late-bound helpers (kept as functions so the table stays declarative)
import { Matrix as _StartupMatrix } from '../math/Matrix';
import { mean as _startupMean } from '../math/stats';
import { initNative as _startupInitNative } from '../math/NativeMath';
import { movingAverage as _startupMovingAverage } from '../analysis/stratigraphy/stratigraphy';
import { efa as _startupEfa } from '../analysis/morphometrics/morphometrics';
import { parseNewick as _startupParseNewick } from '../analysis/phylogenetics/phylogenetics';
import { PluginRegistry as _startupPluginRegistry } from '../plugins/Registry';
import type { Plugin } from '../plugins/Base';
function require_matrix() { return { Matrix: _StartupMatrix }; }
function require_stats() { return { mean: _startupMean }; }
function require_strat() { return { movingAverage: _startupMovingAverage }; }
function require_morpho() { return { efa: _startupEfa }; }
function require_phylo() { return { parseNewick: _startupParseNewick }; }
function require_plugins() { return _startupPluginRegistry; }
