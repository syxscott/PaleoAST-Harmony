import { Plugin } from './Base';

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
