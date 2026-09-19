// Plugin is an interface, so this must be a type-only import.
import type { Plugin } from './Base';

/**
 * Plugin registry for managing analysis plugins.
 * Singleton pattern for centralized plugin management.
 */
class PluginRegistryClass {
  private plugins: Map<string, Plugin> = new Map();

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      console.warn(`Plugin "${plugin.name}" is already registered. Replacing.`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  remove(name: string): boolean {
    return this.plugins.delete(name);
  }

  list(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  clear(): void {
    this.plugins.clear();
  }

  get size(): number {
    return this.plugins.size;
  }
}

// Export singleton instance
export const PluginRegistry = new PluginRegistryClass();

// ─── Convenience accessors (registry.py get_plugin_registry / decorators) ───

/** Alias mirroring Python's get_plugin_registry(). */
export function getPluginRegistry(): PluginRegistryClass {
  return PluginRegistry;
}

/**
 * Decorator form of registration (registry.py register_analysis). Apply to a
 * Plugin-compatible class; instantiates lazily on first use via the factory.
 */
export function registerAnalysis(factory: () => Plugin): void {
  PluginRegistry.register(factory());
}

/** Load a batch of built-in plugin factories (loader.py load_builtin_plugins). */
export function loadBuiltinPlugins(factories: (() => Plugin)[]): number {
  let n = 0;
  for (const f of factories) {
    try {
      PluginRegistry.register(f());
      n++;
    } catch (e) {
      console.warn(`Built-in plugin failed to load: ${String(e)}`);
    }
  }
  return n;
}
