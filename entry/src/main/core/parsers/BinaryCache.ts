/**
 * Binary cache ¡ª replaces parsers/binary_cache.py
 * Stores analysis results in a compact binary format.
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

export function serializeMatrix(data: Float64Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.length * 8 + 64);
  const view = new DataView(buffer);
  // Header
  view.setUint32(0, 0x50414C45); // 'PALE'
  view.setUint32(4, 1); // version
  view.setBigUint64(8, BigInt(data.length * 8));
  // Data
  const dataView = new Float64Array(buffer, 64);
  dataView.set(data);
  return buffer;
}

export function deserializeMatrix(buffer: ArrayBuffer): Float64Array {
  const view = new DataView(buffer);
  const magic = view.getUint32(0);
  if (magic !== 0x50414C45) throw new Error('Invalid cache file');
  return new Float64Array(buffer, 64);
}
