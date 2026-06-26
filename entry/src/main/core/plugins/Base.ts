/**
 * Plugin base ¡ª replaces plugins/base.py
 */

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
}
