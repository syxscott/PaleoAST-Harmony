/**
 * Content fingerprint of the loaded DataMatrix.
 *
 * Plain `.ts` with no ArkUI dependency so it can be unit tested in Node --
 * the same reason `ViewPortHandler` / `ChartComputator` / `ChartHighlighter`
 * live in `components/plot/*.ts` rather than inside a component.
 *
 * Why it exists: the analysis history suppresses a repeat run when the stored
 * `params` string matches the newest record of the same analysis. That is meant
 * to swallow a double-tap, but `params` held only the DIALOG settings, so
 * loading a different dataset and re-running the same analysis was suppressed
 * too, and the run disappeared from the exported reproducible script. The
 * shape is not enough on its own: two different 48x12 datasets have the same
 * `data_shape`. Hence a content hash.
 *
 * This is a fingerprint, not a cryptographic hash. Its only job is to make
 * "same analysis, same settings, same data" decidable in microseconds.
 */
import { DataMatrix } from '../../core/models/index';

/** Reserved key the fingerprint travels under inside the STORED params blob. */
export const DATA_HASH_KEY = '_dataHash';

/**
 * FNV-1a over the matrix's RAW IEEE-754 bytes plus the row and column labels.
 *
 * The bytes are hashed directly rather than through `v & 0xff`: bitwise
 * operators coerce to Int32 and **silently truncate the fraction**, so a
 * first version of this hashed 4 and 4.5 identically -- which is most of a
 * morphometrics or measurement table. Verified against that case.
 *
 * `-0` and `0` therefore hash differently (their bytes differ). That costs at
 * most one redundant history row, which is the safe direction: losing a real
 * run is not.
 */
export function dataFingerprint(dm: DataMatrix | null | undefined): string {
  if (!dm) return 'none';
  let h = 0x811c9dc5;
  const d = dm.data.data;
  const bytes = new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const mixChar = (code: number): void => {
    h ^= code & 0xff; h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (code >>> 8) & 0xff; h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const s of dm.rowLabels) for (let i = 0; i < s.length; i++) mixChar(s.charCodeAt(i));
  for (const s of dm.colLabels) for (let i = 0; i < s.length; i++) mixChar(s.charCodeAt(i));
  return h.toString(16).padStart(8, '0');
}
