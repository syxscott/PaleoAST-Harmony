export interface RowMeta {
  group?: string;
  color?: string;
  weight?: number;
  label?: string;
  excluded?: boolean;
}

export class RowMetadata {
  private _meta: Map<number, RowMeta> = new Map();

  get(index: number): RowMeta | undefined { return this._meta.get(index); }
  set(index: number, meta: RowMeta): void { this._meta.set(index, meta); }
  getGroup(index: number): string | undefined { return this._meta.get(index)?.group; }
  setGroup(index: number, group: string): void {
    const m = this._meta.get(index) ?? {};
    m.group = group;
    this._meta.set(index, m);
  }
  getGroups(): Record<number, string | undefined> {
    const result: Record<number, string | undefined> = {};
    for (const [k, v] of this._meta) result[k] = v.group;
    return result;
  }
  getGroupIndices(): number[] {
    const indices: number[] = [];
    for (const [k, v] of this._meta) if (v.group) indices.push(k);
    return indices;
  }
  clear(): void { this._meta.clear(); }
}
