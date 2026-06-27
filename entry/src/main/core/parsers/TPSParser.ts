/**
 * TPS file parser ¡ª replaces parsers/tps_parser.py
 * Handles LM, ID, IMAGE, CURVES, COMMENTS fields.
 */

export interface TPSRecord {
  id: string;
  landmarks: number[][];
  comment: string;
  imageFile?: string;
  curves?: number[][][];
}

export function parseTPS(text: string): TPSRecord[] {
  const records: TPSRecord[] = [];
  const lines = text.split(/?
/);
  let current: Partial<TPSRecord> | null = null;
  let lmCount = 0;
  let landmarks: number[][] = [];
  let collectingLM = false;
  let curves: number[][][] = [];
  let currentCurve: number[][] = [];
  let collectingCurve = false;

  function flush(): void {
    if (current && landmarks.length > 0) {
      current.landmarks = landmarks;
      if (curves.length > 0) current.curves = curves;
      records.push(current as TPSRecord);
    }
    current = null;
    landmarks = [];
    curves = [];
    collectingLM = false;
    collectingCurve = false;
  }

  for (const line of lines) {
    const t = line.trim();
    if (!t) { flush(); continue; }

    if (t.startsWith('LM=') || t.startsWith('lm=')) {
      flush();
      lmCount = parseInt(t.split('=')[1]) || 0;
      current = current ?? { id: String(records.length + 1), landmarks: [], comment: '' };
      collectingLM = true;
      collectingCurve = false;
      continue;
    }
    if (t.startsWith('LM3=')) {
      flush();
      lmCount = parseInt(t.split('=')[1]) || 0;
      current = current ?? { id: String(records.length + 1), landmarks: [], comment: '' };
      collectingLM = true;
      collectingCurve = false;
      continue;
    }
    if (t.startsWith('ID=') || t.startsWith('id=')) {
      if (!current) current = { id: '', landmarks: [], comment: '' };
      current.id = t.split('=')[1];
      continue;
    }
    if (t.startsWith('COMMENT=') || t.startsWith('comment=')) {
      if (!current) current = { id: '', landmarks: [], comment: '' };
      current.comment = t.substring(t.indexOf('=') + 1);
      continue;
    }
    if (t.startsWith('IMAGE=') || t.startsWith('image=')) {
      if (!current) current = { id: '', landmarks: [], comment: '' };
      current.imageFile = t.substring(t.indexOf('=') + 1);
      continue;
    }
    if (t.startsWith('CURVES=') || t.startsWith('curves=')) {
      collectingLM = false;
      collectingCurve = true;
      currentCurve = [];
      continue;
    }

    // Landmark data
    if (collectingLM && lmCount > 0) {
      const parts = t.split(/[\s,]+/).map(Number);
      if (parts.length >= 2 && !isNaN(parts[0])) {
        landmarks.push([parts[0], parts[1]]);
        if (landmarks.length >= lmCount) collectingLM = false;
      }
      continue;
    }

    // Curve data
    if (collectingCurve) {
      const parts = t.split(/[\s,]+/).map(Number);
      if (parts.length >= 2 && !isNaN(parts[0])) {
        currentCurve.push([parts[0], parts[1]]);
      } else if (currentCurve.length > 0) {
        curves.push(currentCurve);
        currentCurve = [];
      }
      continue;
    }
  }
  flush();
  return records;
}
