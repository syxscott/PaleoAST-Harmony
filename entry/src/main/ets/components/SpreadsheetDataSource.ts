/**
 * SpreadsheetDataSource — LazyForEach data source for large datasets.
 * Replaces ForEach to avoid DOM node explosion with 1000+ rows.
 * Implements IDataSource for on-demand row rendering.
 */
export class SpreadsheetDataSource implements IDataSource {
  private listeners: DataChangeListener[] = [];
  private rowIndices: number[] = [];

  totalCount(): number {
    return this.rowIndices.length;
  }

  getData(index: number): any {
    return this.rowIndices[index];
  }

  registerDataChangeListener(listener: DataChangeListener): void {
    this.listeners.push(listener);
  }

  unregisterDataChangeListener(listener: DataChangeListener): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  /**
   * Set the row indices to display (after filtering/sorting).
   * Triggers onDataReloaded to refresh LazyForEach.
   */
  setRowIndices(indices: number[]): void {
    this.rowIndices = indices;
    for (const l of this.listeners) {
      l.onDataReloaded();
    }
  }

  /**
   * Notify that a specific row's data changed.
   * Triggers onDataChange for incremental update.
   */
  notifyRowChanged(rowIndex: number): void {
    const displayIdx = this.rowIndices.indexOf(rowIndex);
    if (displayIdx >= 0) {
      for (const l of this.listeners) {
        l.onDataChange(displayIdx);
      }
    }
  }
}
