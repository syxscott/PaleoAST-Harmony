/**
 * Test bootstrap: register the extensionless-import loader, then run.
 * Run: node tests/test.mjs
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./loader.mjs', pathToFileURL('./tests/'));

await import('./run.ts');
