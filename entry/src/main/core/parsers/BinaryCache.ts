/**
 * Binary cache ¡ª replaces parsers/binary_cache.py
 * Stores analysis results in a compact binary format.
 *
 * Layout (version 2):
 *   [0..3]   magic 'PALE' (0x50414C45)
 *   [4..7]   version
 *   [8..15]  payload length in bytes (u64)
 *   [16..19] nRows
 *   [20..23] nCols
 *   [24..27] CRC32 of the payload (verified on load)
 *   [28..31] flags (reserved)
 *   [32..63] reserved
 *   [64..]   payload (Float64Array little-endian)
 */

export interface CacheHeader {
  magic: number;
  version: number;
  nRows: number;
  nCols: number;
  matrixSize: number;
  metadataOffset: number;
  metadataLength: number;
  crc32: number;
  flags: number;
}

const HEADER_SIZE = 64;
const MAGIC = 0x50414C45; // 'PALE'
const VERSION = 2;

/** Standard CRC-32 (IEEE 802.3 polynomial 0xEDB88320, reflected). */
export function crc32(data: Uint8Array): number {
  // Lazily-built 256-entry lookup table
  if (crc32Table.length === 0) {
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      }
      crc32Table[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
const crc32Table: number[] = [];

export interface SerializeOptions {
  nRows?: number;
  nCols?: number;
}

export function serializeMatrix(data: Float64Array, options?: SerializeOptions): ArrayBuffer {
  const buffer = new ArrayBuffer(data.length * 8 + HEADER_SIZE);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC);
  view.setUint32(4, VERSION);
  view.setBigUint64(8, BigInt(data.length * 8));
  view.setUint32(16, options?.nRows ?? 0);
  view.setUint32(20, options?.nCols ?? 0);
  const bytes = new Uint8Array(buffer, HEADER_SIZE);
  new Float64Array(buffer, HEADER_SIZE).set(data);
  view.setUint32(24, crc32(bytes));
  view.setUint32(28, 0); // flags reserved
  return buffer;
}

export function deserializeMatrix(buffer: ArrayBuffer): Float64Array {
  const view = new DataView(buffer);
  const magic = view.getUint32(0);
  if (magic !== MAGIC) throw new Error('Invalid cache file: bad magic');
  const version = view.getUint32(4);
  if (version !== VERSION) throw new Error(`Unsupported cache version: ${version}`);
  const expectedBytes = Number(view.getBigUint64(8));

  // Verify CRC32 of the payload before returning any data
  const storedCrc = view.getUint32(24);
  const payload = new Uint8Array(buffer, HEADER_SIZE);
  const actualCrc = crc32(payload);
  if (storedCrc !== 0 && storedCrc !== actualCrc) {
    throw new Error(`Cache payload corrupt: CRC32 mismatch (stored ${storedCrc}, computed ${actualCrc})`);
  }
  if (payload.byteLength !== expectedBytes) {
    throw new Error(`Cache payload length mismatch: header ${expectedBytes}, actual ${payload.byteLength}`);
  }
  return new Float64Array(buffer, HEADER_SIZE);
}

/** Read just the header of a cache buffer without touching the payload. */
export function readCacheHeader(buffer: ArrayBuffer): CacheHeader {
  const view = new DataView(buffer);
  return {
    magic: view.getUint32(0),
    version: view.getUint32(4),
    nRows: view.getUint32(16),
    nCols: view.getUint32(20),
    matrixSize: Number(view.getBigUint64(8)),
    metadataOffset: HEADER_SIZE,
    metadataLength: Number(view.getBigUint64(8)),
    crc32: view.getUint32(24),
    flags: view.getUint32(28),
  };
}

/** Thrown when a cache payload fails CRC or structural validation. */
export class CorruptedCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptedCacheError';
  }
}

/** Convenience wrapper (binary_cache.py save_matrix): serialize + row/col counts. */
export function saveMatrix(data: Float64Array, nRows: number, nCols: number): ArrayBuffer {
  return serializeMatrix(data, { nRows, nCols });
}

/** Convenience wrapper (binary_cache.py load_matrix): deserialize + validate shape. */
export function loadMatrix(buffer: ArrayBuffer): { data: Float64Array; nRows: number; nCols: number } {
  const header = readCacheHeader(buffer);
  const data = deserializeMatrix(buffer);
  return { data, nRows: header.nRows, nCols: header.nCols };
}
