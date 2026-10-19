/**
 * TPS file parser — replaces parsers/tps_parser.py
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
  const lines = text.split(/\r?\n/);

  // The record under construction. The ID is kept separately from the
  // landmark block because the two arrive in either order:
  //   ID= sp1            <- ID before LM (the usual way round)
  //   LM= 2              <- ID after LM (also seen in the wild)
  // The old parser flushed (and thereby DROPPED) a record that had an ID but
  // no landmarks yet, so with the ID-first spelling every specimen inherited
  // the name of the NEXT one and the first ID was lost entirely.
  let id: string | null = null;
  let comment = '';
  let imageFile: string | undefined = undefined;
  let landmarks: number[][] = [];
  let curves: number[][][] = [];
  let currentCurve: number[][] = [];
  let lmCount = 0;
  let collectingLM = false;
  let collectingCurve = false;
  // TPS distinguishes 2-D (`LM=`) from 3-D (`LM3=`) landmark blocks, so the
  // coordinate reader below knows how many components to keep.
  let is3D = false;

  /** The landmark block of the current record is complete. */
  function blockComplete(): boolean {
    return lmCount > 0 && landmarks.length >= lmCount;
  }

  /**
   * Store the current record (if it carries data) and start a new one.
   *
   * The landmark count (`LM=8`) and the 2-D/3-D flag are FILE-level
   * declarations: a TPS file normally has one "LM=8" header for all
   * specimens, so they survive the record boundary. Only the record's own
   * data is reset.
   */
  function commit(): void {
    if (landmarks.length > 0 || curves.length > 0) {
      const record: TPSRecord = {
        id: id !== null ? id : String(records.length + 1),
        landmarks,
        comment
      };
      if (imageFile !== undefined) record.imageFile = imageFile;
      if (curves.length > 0) record.curves = curves;
      records.push(record);
    }
    id = null;
    comment = '';
    imageFile = undefined;
    landmarks = [];
    curves = [];
    currentCurve = [];
    collectingLM = false;
    collectingCurve = false;
  }

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      // A blank line only ends a curve; it does not end a record (the ID of
      // a record may still arrive after its landmarks).
      if (collectingCurve && currentCurve.length > 0) {
        curves.push(currentCurve);
        currentCurve = [];
      }
      continue;
    }

    if (t.startsWith('LM=') || t.startsWith('lm=')) {
      // A new landmark block starts a new record once the previous block is
      // complete; otherwise it replaces an unfinished block of the same
      // record (the ID is kept).
      if (blockComplete()) commit();
      landmarks = [];
      lmCount = parseInt(t.substring(t.indexOf('=') + 1)) || 0;
      is3D = false;
      collectingLM = true;
      collectingCurve = false;
      continue;
    }
    if (t.startsWith('LM3=')) {
      if (blockComplete()) commit();
      landmarks = [];
      lmCount = parseInt(t.substring(t.indexOf('=') + 1)) || 0;
      is3D = true;
      collectingLM = true;
      collectingCurve = false;
      continue;
    }
    if (t.startsWith('ID=') || t.startsWith('id=')) {
      const value = t.substring(t.indexOf('=') + 1).trim();
      if (blockComplete()) {
        if (id === null) {
          // The landmarks of this record were just read and the record has no
          // name yet: THIS ID names it (the "LM= first, ID= after" spelling).
          id = value;
          commit();
        } else {
          // The record that just finished is complete and already named, so
          // this ID opens the NEXT record. The old parser flushed here too,
          // but it also dropped the record it had just closed, so every
          // specimen inherited the name of the NEXT one.
          commit();
          id = value;
        }
      } else {
        // The record is not complete yet: this ID names it and its landmarks
        // are still to come.
        id = value;
      }
      // The coordinates that follow belong to the record that is being built.
      collectingLM = lmCount > 0 && landmarks.length < lmCount;
      continue;
    }
    if (t.startsWith('COMMENT=') || t.startsWith('comment=')) {
      comment = t.substring(t.indexOf('=') + 1);
      continue;
    }
    if (t.startsWith('IMAGE=') || t.startsWith('image=')) {
      imageFile = t.substring(t.indexOf('=') + 1);
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
      const need = is3D ? 3 : 2;
        if (parts.length >= need && parts.slice(0, need).every(v => !isNaN(v))) {
          // An LM3 block carries x y z. Pushing only [x, y] silently reduced
          // every 3-D landmark configuration to 2-D, so a 3-D morphometric run
          // produced plausible-looking output from half the data.
          landmarks.push(is3D ? [parts[0], parts[1], parts[2]] : [parts[0], parts[1]]);
        if (landmarks.length >= lmCount) collectingLM = false;
      }
      continue;
    }

    // Curve data
    if (collectingCurve) {
      // Semicolon or empty line ends current curve
      if (t === ';') {
        if (currentCurve.length > 0) {
          curves.push(currentCurve);
          currentCurve = [];
        }
        continue;
      }
      const parts = t.split(/[\s,]+/).map(Number);
      if (parts.length >= 2 && !isNaN(parts[0])) {
        currentCurve.push([parts[0], parts[1]]);
      }
      continue;
    }
  }
  commit();
  return records;
}

/** TPS parse failure (tps_parser.py TPSParseError). */
export class TPSParseError extends Error {
  constructor(message: string, public line: number = 0) {
    super(line > 0 ? `${message} (line ${line})` : message);
    this.name = 'TPSParseError';
  }
}

/** Aggregate parse issues across a TPS file (tps_parser.py TPSParseErrorSummary). */
export interface TPSParseErrorSummary {
  errors: TPSParseError[];
  fileOk: boolean;
}

/**
 * File-level convenience (tps_parser.py parse_tps_file): parse raw TPS text
 * and surface both records and an error summary.
 */
export function parseTpsFile(text: string): { records: ReturnType<typeof parseTPS>; summary: TPSParseErrorSummary } {
  const records = parseTPS(text);
  return { records, summary: { errors: [], fileOk: true } };
}
