/**
 * ESM hooks for the test runner:
 *  - resolve: extensionless relative imports resolve to .ts files
 *  - load: strips ArkUI-only decorators from models/ and redirects
 *    '@kit.ArkUI' / '@kit.CoreFileKit' imports to plain-TS shims, so core
 *    modules are testable under node --experimental-transform-types.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHIMS = {
  '@kit.ArkUI': '../entry/src/main/tests/shims/arkui.ts',
  '@kit.CoreFileKit': '../entry/src/main/tests/shims/corefilekit.ts',
};

export async function resolve(specifier, context, next) {
  if (Object.prototype.hasOwnProperty.call(SHIMS, specifier)) {
    return {
      shortCircuit: true,
      url: new URL(SHIMS[specifier], import.meta.url).href,
    };
  }
  try {
    return await next(specifier, context);
  } catch (e) {
    if (specifier.startsWith('.') && context.parentURL) {
      const base = new URL(specifier, context.parentURL).href;
      for (const suffix of ['.ts', '/index.ts']) {
        try {
          return await next(base + suffix, context);
        } catch {
          /* try next candidate */
        }
      }
    }
    throw e;
  }
}

export async function load(url, context, next) {
  if (url.endsWith('.ts')) {
    const path = fileURLToPath(url);
    let source = readFileSync(path, 'utf8');
    if (source.includes('@Observed')) {
      source = source.replace(/^\s*@Observed\s*$/gm, '');
    }
    if (source !== readFileSync(path, 'utf8')) {
      return { format: 'module-typescript', shortCircuit: true, source };
    }
  }
  return next(url, context);
}
