export type ColumnDataType = 'numeric' | 'categorical' | 'ordinal' | 'binary';

export interface ColumnMeta {
  name: string;
  type: ColumnDataType;
  unit?: string;
  min?: number;
  max?: number;
  mean?: number;
  missingCount?: number;
}

export class ColumnMetadata {
  private _meta: Map<number, ColumnMeta> = new Map();

  get(index: number): ColumnMeta | undefined { return this._meta.get(index); }
  set(index: number, meta: ColumnMeta): void { this._meta.set(index, meta); }
  getAll(): ColumnMeta[] {
    const result: ColumnMeta[] = [];
    for (const [_, v] of this._meta) result.push(v);
    return result;
  }
  getNames(): string[] { return this.getAll().map(m => m.name); }
  clear(): void { this._meta.clear(); }
}
