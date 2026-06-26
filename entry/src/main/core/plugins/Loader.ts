/**
 * Plugin loader ¡ª replaces plugins/loader.py
 */

import { Plugin } from './Base';
import { PluginRegistry } from './Registry';

export function loadPlugin(plugin: Plugin): void { PluginRegistry.register(plugin); }
export function loadPlugins(plugins: Plugin[]): void { for (const p of plugins) loadPlugin(p); }
export function unloadPlugin(name: string): boolean { return PluginRegistry.remove(name); }
