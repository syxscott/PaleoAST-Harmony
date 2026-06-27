/**
 * SpreadsheetDataSource — LazyForEach data source for large datasets.
 * Replaces ForEach to avoid DOM node explosion with 1000+ rows.
 */
export class SpreadsheetDataSource implements IDataSource {
  private listeners: DataChangeListener[] = [];
  private data: number[][] = [];
  private rowLabels: string[] = [];
  private colLabels: string[] = [];

  totalCount(): number {
    return this.data.length;
  }

  getData(index: number): any {
    return {
      rowLabel: this.rowLabels[index] || ('Row_' + (index + 1)),
      values: this.data[index] || [],
      rowIndex: index,
    };
  }

  registerDataChangeListener(listener: DataChangeListener): void {
    this.listeners.push(listener);
  }

  unregisterDataChangeListener(listener: DataChangeListener): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  setData(data: number[][], rowLabels: string[], colLabels: string[]): void {
    this.data = data;
    this.rowLabels = rowLabels;
    this.colLabels = colLabels;
    for (const l of this.listeners) {
      l.onDataReloaded();
    }
  }

  updateRow(index: number, values: number[]): void {
    this.data[index] = values;
    for (const l of this.listeners) {
      l.onDataChange(index);
    }
  }

  getData(): number[][] { return this.data; }
  getRowLabels(): string[] { return this.rowLabels; }
  getColLabels(): string[] { return this.colLabels; }
}
