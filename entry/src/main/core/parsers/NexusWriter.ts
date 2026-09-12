/**
 * NEXUS format writer — port of parsers/nexus_writer.py (Maddison, Swofford
 * & Maddison 1997 NEXUS standard). Emits TAXA, CHARACTERS and TREES blocks
 * with proper quoting of names containing whitespace or reserved characters.
 */

const RESERVED = /[()\[\]{}\\;:,.'"`\s]/;

/** Quote a name when it contains whitespace or reserved punctuation. */
function quoteIfNeeded(name: string): string {
  if (name.length === 0 || RESERVED.test(name)) {
    return `'${name.replace(/'/g, "''")}'`;
  }
  return name;
}

export interface NexusTaxonMetadata {
  [key: string]: string | number | boolean;
}

export interface NexusTreeEntry {
  name: string;
  newick: string;
}

/**
 * NEXUS document builder (nexus_writer.py NEXUSWriter).
 *
 * Usage:
 *   const w = new NEXUSWriter({ taxa: ['A', 'B'], matrix: { A: 'ACGT', B: 'ACGA' } });
 *   w.addTree('tree1', '(A,B);');
 *   const text = w.write();           // NEXUS document string
 *   writeNexus(path, w)               // convenience wrapper (text to disk)
 */
export class NEXUSWriter {
  private _title: string = 'PaleoAST';
  private _taxa: string[] = [];
  private _taxaMetadata: Record<string, NexusTaxonMetadata> = {};
  private _datatype: string = 'DNA';
  private _interleaved: boolean = false;
  private _gapChar: string = '-';
  private _missingChar: string = '?';
  private _charLabels: string[] = [];
  private _matrix: Record<string, string> = {};
  private _trees: NexusTreeEntry[] = [];

  constructor(options?: {
    title?: string;
    taxa?: string[];
    taxaMetadata?: Record<string, NexusTaxonMetadata>;
    matrix?: Record<string, string>;
    datatype?: string;
    interleaved?: boolean;
    gap?: string;
    missing?: string;
    charLabels?: string[];
  }) {
    if (options?.title !== undefined) this._title = options.title;
    if (options?.taxa) this.setTaxa(options.taxa, options.taxaMetadata);
    if (options?.matrix) {
      this.setData(options.matrix, {
        datatype: options.datatype,
        interleaved: options.interleaved,
        gap: options.gap,
        missing: options.missing,
        charLabels: options.charLabels,
      });
    }
  }

  setTitle(title: string): void {
    this._title = title;
  }

  /** Define the taxon block; ordering is preserved. */
  setTaxa(taxa: string[], metadata?: Record<string, NexusTaxonMetadata>): void {
    this._taxa = [...taxa];
    this._taxaMetadata = metadata ? { ...metadata } : {};
  }

  /** Define the character matrix and its FORMAT declaration. */
  setData(
    matrix: Record<string, string>,
    options?: { datatype?: string; interleaved?: boolean; gap?: string; missing?: string; charLabels?: string[] },
  ): void {
    this._matrix = { ...matrix };
    if (options?.datatype) this._datatype = options.datatype;
    if (options?.interleaved !== undefined) this._interleaved = options.interleaved;
    if (options?.gap) this._gapChar = options.gap;
    if (options?.missing) this._missingChar = options.missing;
    if (options?.charLabels) this._charLabels = [...options.charLabels];

    // Validate cells: uniform alphabet per datatype basics
    const lengths = new Set<string>();
    for (const taxon of Object.keys(this._matrix)) {
      lengths.add(String(this._matrix[taxon].length));
    }
    if (lengths.size > 1) {
      throw new Error(`NEXUSWriter: matrix rows have inconsistent lengths: ${[...lengths].join(', ')}`);
    }
  }

  /** Add a tree in NEWICK form under BEGIN TREES. */
  addTree(name: string, newick: string): void {
    this._trees.push({ name, newick });
  }

  /** Assemble the complete NEXUS document. */
  write(): string {
    const lines: string[] = ['#NEXUS', '', `BEGIN TAXA;`, `    TITLE ${quoteIfNeeded(this._title)}_taxa;`];

    // ── TAXA block ──
    const taxa = this._taxa.length > 0 ? this._taxa : Object.keys(this._matrix);
    lines.push(`    NTAX ${taxa.length};`);
    lines.push(`    TAXLABELS ${taxa.map(quoteIfNeeded).join(' ')};`);
    lines.push('END;', '');

    // ── CHARACTERS block ──
    const taxaInMatrix = Object.keys(this._matrix);
    if (taxaInMatrix.length > 0) {
      const nchar = this._matrix[taxaInMatrix[0]].length;
      lines.push('BEGIN CHARACTERS;');
      lines.push(`    TITLE ${quoteIfNeeded(this._title)}_chars;`);
      lines.push(`    NCHAR ${nchar};`);
      lines.push(`    FORMAT DATATYPE=${this._datatype} INTERLEAVE=${this._interleaved ? 'yes' : 'no'} GAP=${this._gapChar} MISSING=${this._missingChar};`);
      if (this._charLabels.length > 0) {
        lines.push(`    CHARLABELS ${this._charLabels.map(quoteIfNeeded).join(' ')};`);
      }
      lines.push('    MATRIX');
      const width = Math.max(...taxaInMatrix.map(t => quoteIfNeeded(t).length));
      for (const taxon of taxaInMatrix) {
        const label = quoteIfNeeded(taxon).padEnd(width);
        const meta = this._taxaMetadata[taxon];
        const metaText = meta
          ? '  [' + Object.keys(meta).map(k => `${k}=${String(meta[k])}`).join(', ') + ']'
          : '';
        lines.push(`        ${label}  ${this._matrix[taxon]}${metaText}`);
      }
      lines.push('    ;');
      lines.push('END;', '');
    }

    // ── TREES block ──
    if (this._trees.length > 0) {
      lines.push('BEGIN TREES;');
      lines.push(`    TITLE ${quoteIfNeeded(this._title)}_trees;`);
      lines.push('    FORMAT NEWICK;');
      for (const tree of this._trees) {
        lines.push(`    TREE ${quoteIfNeeded(tree.name)} = ${tree.newick}`);
      }
      lines.push('END;', '');
    }

    lines.push('END;');
    return lines.join('\n');
  }
}

/**
 * Convenience function mirroring nexus_writer.py write_nexus: produce the
 * NEXUS text for a matrix (+ optional trees). The caller persists the string
 * (the Harmony sandbox has no direct path write access from core/).
 */
export function writeNexus(
  matrix: Record<string, string>,
  options?: {
    title?: string;
    datatype?: string;
    trees?: NexusTreeEntry[];
    charLabels?: string[];
    gap?: string;
    missing?: string;
    interleaved?: boolean;
  },
): string {
  const writer = new NEXUSWriter({ title: options?.title, matrix, datatype: options?.datatype, charLabels: options?.charLabels, gap: options?.gap, missing: options?.missing, interleaved: options?.interleaved });
  if (options?.trees) {
    for (const t of options.trees) writer.addTree(t.name, t.newick);
  }
  return writer.write();
}
