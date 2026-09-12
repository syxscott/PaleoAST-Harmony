import { DataMatrix } from "../../core/models/index";
import { SpreadsheetDataSource } from "./SpreadsheetDataSource";
import { Matrix } from "../../core/math/Matrix";

/**
 * Scientific Spreadsheet Component — replaces views/ui_spreadsheet.py
 * Full-featured data table with:
 * - LazyForEach + IDataSource for virtualized rendering (no DOM explosion)
 * - V1 state management only (@Component + @State + @ObjectLink; the previous
 *   @ObservedV2/@Trace/@Local mix was invalid inside a struct)
 * - Row/column selection
 * - Group assignment (colored row labels)
 * - Sorting by column
 * - Filtering
 * - NaN/missing value display
 * - Double-click cell editing
 */
@Component
export struct Spreadsheet {
  @ObjectLink dataMatrix: DataMatrix;
  @State selectedRow: number = -1;
  @State selectedCol: number = -1;
  @State selectedRows: Set<number> = new Set();
  @State @Watch('onRowsCacheDirty') sortColumn: number = -1;
  @State @Watch('onRowsCacheDirty') sortAscending: boolean = true;
  @State @Watch('onRowsCacheDirty') filterText: string = '';
  @State editValue: string = '';
  @State groupColors: Map<string, string> = new Map([
    ['Group_A', '#3498DB'], ['Group_B', '#E74C3C'], ['Group_C', '#27AE60'],
    ['Group_D', '#F39C12'], ['Ungrouped', '#95A5A6'],
  ]);
  @State rowGroups: string[] = []; // group label per row
  @State darkMode: boolean = false;
  @State showGroups: boolean = true;
  @State editingCell: string | null = null;
  @State filteredRowsCache: number[] = []; // memoized filtered/sorted rows

  // Pre-computed column indices array (moved outside build)
  private columnIndices: number[] = [];

  // Callbacks - use these to notify parent of changes instead of direct prop mutation
  onDataChanged: (data: Matrix) => void = () => {};
  onSelectionChanged: (rows: number[], cols: number[]) => void = () => {};
  onGroupChanged: (groups: string[]) => void = () => {};

  // LazyForEach data source — recomputed outside the render path
  private dataSource: SpreadsheetDataSource = new SpreadsheetDataSource();

  aboutToAppear(): void {
    if (this.dataMatrix) {
      this.rowGroups = Array.from({ length: this.dataMatrix.nSamples }, () => 'Ungrouped');
    }
    this.initColumnIndices();
    this.recomputeRows();
  }

  // @Watch callback: filter/sort inputs changed → rebuild row cache (not in build)
  onRowsCacheDirty(): void {
    this.recomputeRows();
  }

  // Initialize column indices once
  private initColumnIndices(): void {
    if (this.dataMatrix) {
      this.columnIndices = Array.from({ length: this.dataMatrix.nVariables }, (_, i) => i);
    }
  }

  build() {
    Column() {
      // ─── Toolbar ───
      this.Toolbar()

      // ─── Data Grid ───
      Scroll() {
        Column() {
          // Header row
          this.HeaderRow()
          // Data rows
          this.DataRows()
        }
      }.layoutWeight(1).width('100%')

      // ─── Status Bar ───
      this.StatusBar()
    }.width('100%').height('100%')
    .backgroundColor(this.darkMode ? '#1a1a2e' : '#FFFFFF')
  }

  @Builder Toolbar() {
    Row() {
      if (this.showGroups) {
        Text('Groups:').fontSize(11).fontColor('#7F8C8D').margin({ right: 4 })
        Button('Set Group').fontSize(10).height(24).margin({ right: 4 })
          .onClick(() => { this.assignGroup(); })
        Button('Clear Groups').fontSize(10).height(24).margin({ right: 4 })
          .onClick(() => { this.clearGroups(); })
      }
      Blank()
      TextInput({ placeholder: 'Filter rows...' })
        .width(160).height(24).fontSize(11)
        .onChange((v: string) => { this.filterText = v; })
    }
    .width('100%').height(32).padding({ left: 8, right: 8 })
    .backgroundColor(this.darkMode ? '#16213e' : '#F8F9FA')
    .border({ width: { bottom: 1 }, color: '#E4E7EB' })
  }

  @Builder HeaderRow() {
    Row() {
      // Row number header
      Text('#').width(40).fontSize(10).fontWeight(FontWeight.Bold)
        .textAlign(TextAlign.Center).fontColor(this.darkMode ? '#ccc' : '#2C3E50')

      // Group column (if enabled)
      if (this.showGroups) {
        Text('Group').width(60).fontSize(10).fontWeight(FontWeight.Bold)
          .textAlign(TextAlign.Center).fontColor(this.darkMode ? '#ccc' : '#2C3E50')
      }

      // Column headers
      if (this.dataMatrix != null) {
        ForEach(this.dataMatrix.colLabels, (label: string, colIdx: number) => {
          Text(label).width(80).fontSize(10).fontWeight(FontWeight.Bold)
            .textAlign(TextAlign.Center)
            .fontColor(this.sortColumn === colIdx ? '#3498DB' : (this.darkMode ? '#ccc' : '#2C3E50'))
            .backgroundColor(this.sortColumn === colIdx ? '#EBF5FB' : 'transparent')
            .onClick(() => {
              if (this.sortColumn === colIdx) { this.sortAscending = !this.sortAscending; }
              else { this.sortColumn = colIdx; this.sortAscending = true; }
            })
        })
      }
    }
    .width('100%').height(26)
    .backgroundColor(this.darkMode ? '#0f3460' : '#E4E7EB')
  }

  @Builder DataRows() {
    if (this.dataMatrix != null) {
      // True LazyForEach: only renders visible rows, prevents DOM explosion.
      // Row indices come from the pre-computed filteredRowsCache (kept in sync
      // by @Watch callbacks — the render path never writes state).
      LazyForEach(this.dataSource, (rowIdx: number) => {
        Row() {
          // Row number
          Text(String(rowIdx + 1)).width(40).fontSize(10).textAlign(TextAlign.Center)
            .fontColor(this.darkMode ? '#aaa' : '#7F8C8D')
            .backgroundColor(this.selectedRow === rowIdx ? '#EBF5FB' : 'transparent')

          // Group indicator
          if (this.showGroups) {
            Text(this.rowGroups[rowIdx] ?? 'Ungrouped').width(60).fontSize(9).textAlign(TextAlign.Center)
              .fontColor('#FFFFFF')
              .backgroundColor(this.groupColors.get(this.rowGroups[rowIdx] ?? 'Ungrouped') ?? '#95A5A6')
              .borderRadius(4).padding(2)
          }

          // Data cells — use pre-computed columnIndices; TextInput while editing
          ForEach(this.columnIndices, (_: Object, colIdx: number) => {
            if (this.editingCell === `${rowIdx},${colIdx}`) {
              TextInput({ text: this.editValue })
                .width(80).height(20).fontSize(10)
                .onChange((v: string) => { this.editValue = v; })
                .onSubmit(() => { this.commitEdit(); })
            } else {
              Text(this.getCellDisplay(rowIdx, colIdx))
                .width(80).fontSize(10).textAlign(TextAlign.Right)
                .fontColor(this.getCellFontColor(rowIdx, colIdx))
                .backgroundColor(this.getCellBg(rowIdx, colIdx))
                .onClick(() => {
                  if (this.editingCell !== null) { this.cancelEdit(); }
                  this.selectedRow = rowIdx;
                  this.selectedCol = colIdx;
                })
                .onDoubleClick(() => { this.startEditing(rowIdx, colIdx); })
            }
          })
        }
        .width('100%').height(22)
        .backgroundColor(this.selectedRow === rowIdx ? '#EBF5FB' : (rowIdx % 2 === 0 ? 'transparent' : (this.darkMode ? '#16213e08' : '#F8F9FA08')))
      }, (rowIdx: number) => rowIdx.toString()) // stable key per row
    }
  }

  @Builder StatusBar() {
    Row() {
      if (this.selectedRow >= 0 && this.selectedCol >= 0) {
        const val = this.dataMatrix?.data.get(this.selectedRow, this.selectedCol) ?? NaN;
        Text(`Row ${this.selectedRow + 1}, Col ${this.selectedCol + 1}: ${this.formatCell(val)}`)
          .fontSize(11).fontColor('#7F8C8D')
      } else if (this.dataMatrix != null) {
        Text(`${this.dataMatrix.nSamples} rows x ${this.dataMatrix.nVariables} columns`)
          .fontSize(11).fontColor('#7F8C8D')
      }
      Blank()
      if (this.selectedRows.size > 0) {
        Text(`${this.selectedRows.size} rows selected`).fontSize(11).fontColor('#7F8C8D')
      }
    }
    .width('100%').height(24).padding({ left: 8, right: 8 })
    .backgroundColor(this.darkMode ? '#16213e' : '#F8F9FA')
    .border({ width: { top: 1 }, color: '#E4E7EB' })
  }

  // ─── Cell Display ───────────────────────────────────────────────

  private getCellDisplay(row: number, col: number): string {
    const val = this.dataMatrix?.data.get(row, col) ?? NaN;
    return this.formatCell(val);
  }

  private getCellFontColor(row: number, col: number): string {
    const val = this.dataMatrix?.data.get(row, col) ?? NaN;
    if (isNaN(val)) return '#E74C3C';
    if (val < 0) return '#F39C12';
    return this.darkMode ? '#ccc' : '#2C3E50';
  }

  private getCellBg(row: number, col: number): string {
    if (row === this.selectedRow && col === this.selectedCol) return '#3498DB40';
    if (row === this.selectedRow) return '#EBF5FB';
    if (col === this.selectedCol) return '#FDF2E9';
    return 'transparent';
  }

  private formatCell(value: number): string {
    if (isNaN(value)) return 'NA';
    if (!isFinite(value)) return value > 0 ? '+Inf' : '-Inf';
    if (Number.isInteger(value) && Math.abs(value) < 1e10) return value.toString();
    if (Math.abs(value) < 0.001 || Math.abs(value) >= 1e6) return value.toExponential(3);
    return value.toFixed(4);
  }

  // ─── Filtering / Sorting cache (kept out of the render path) ────

  private recomputeRows(): void {
    if (!this.dataMatrix) {
      this.filteredRowsCache = [];
      this.dataSource.setRowIndices(this.filteredRowsCache);
      return;
    }
    let rows = Array.from({ length: this.dataMatrix.nSamples }, (_, i) => i);

    // Filter
    if (this.filterText) {
      const ft = this.filterText.toLowerCase();
      rows = rows.filter(i => {
        const label = this.dataMatrix!.rowLabels[i]?.toLowerCase() ?? '';
        return label.includes(ft);
      });
    }

    // Sort
    if (this.sortColumn >= 0 && this.sortColumn < this.dataMatrix.nVariables) {
      rows.sort((a, b) => {
        const va = this.dataMatrix!.data.get(a, this.sortColumn);
        const vb = this.dataMatrix!.data.get(b, this.sortColumn);
        const cmp = (isNaN(va) ? Infinity : va) - (isNaN(vb) ? Infinity : vb);
        return this.sortAscending ? cmp : -cmp;
      });
    }

    this.filteredRowsCache = rows;
    this.dataSource.setRowIndices(this.filteredRowsCache);
  }

  // ─── Cell Editing ───────────────────────────────────────────────

  private startEditing(row: number, col: number): void {
    if (!this.dataMatrix) return;
    const val = this.dataMatrix.data.get(row, col);
    this.editValue = isNaN(val) ? '' : String(val);
    this.editingCell = `${row},${col}`;
  }

  private commitEdit(): void {
    if (this.editingCell === null) return;
    const parts = this.editingCell.split(',');
    if (parts.length !== 2) return;
    const row = parseInt(parts[0]), col = parseInt(parts[1]);
    if (!this.dataMatrix) return;

    const newVal = this.editValue.trim().toLowerCase() === 'na' ? NaN : parseFloat(this.editValue);
    if (!isNaN(newVal) || this.editValue.trim().toLowerCase() === 'na') {
      const finalVal = isNaN(newVal) ? NaN : newVal;
      this.dataMatrix.data.set(row, col, finalVal);
      // Matrix itself is not observable — refresh the edited row explicitly
      this.dataSource.notifyRowChanged(row);
      // Notify parent via callback since @ObjectLink doesn't auto-sync edits back
      this.onDataChanged(this.dataMatrix.data);
    }
    this.editingCell = null;
    this.editValue = '';
  }

  private cancelEdit(): void {
    this.editingCell = null;
    this.editValue = '';
  }

  // ─── Group Management ───────────────────────────────────────────

  private assignGroup(): void {
    if (this.selectedRow < 0) return;
    // groupColors is a Map — Object.keys() on it is always []; use keys()
    const groups = Array.from(this.groupColors.keys());
    if (groups.length === 0) return;
    const currentGroup = this.rowGroups[this.selectedRow] ?? 'Ungrouped';
    const idx = groups.indexOf(currentGroup);
    // Rotate to the next group (idx === -1 → start with the first group)
    this.rowGroups[this.selectedRow] = groups[(idx + 1) % groups.length];
    this.onGroupChanged(this.rowGroups);
  }

  private clearGroups(): void {
    this.rowGroups = Array.from({ length: this.dataMatrix?.nSamples ?? 0 }, () => 'Ungrouped');
    this.onGroupChanged(this.rowGroups);
  }

  // ─── Public API ─────────────────────────────────────────────────

  loadData(data: number[][], rowLabels: string[], colLabels: string[]): void {
    if (!this.dataMatrix) return;
    // @ObjectLink variables cannot be reassigned — copy values in place
    // (dimensions must match the matrix passed at construction).
    const rows = Math.min(data.length, this.dataMatrix.nSamples);
    const cols = Math.min(rows > 0 ? data[0].length : 0, this.dataMatrix.nVariables);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        this.dataMatrix.data.set(i, j, data[i][j]);
      }
    }
    this.rowGroups = Array.from({ length: this.dataMatrix.nSamples }, () => 'Ungrouped');
    this.selectedRows = new Set<number>();
    this.selectedRow = -1;
    this.initColumnIndices();
    this.recomputeRows();
  }

  getSelectedData(): number[][] {
    if (this.dataMatrix == null) return [];
    const rows = this.selectedRows.size > 0 ? Array.from(this.selectedRows) : [this.selectedRow];
    return rows.filter(r => r >= 0).map(r => this.dataMatrix!.data.row(r));
  }

  getSelectedRows(): number[] {
    return this.selectedRows.size > 0 ? Array.from(this.selectedRows) : [this.selectedRow].filter(r => r >= 0);
  }

  getGroups(): string[] { return this.rowGroups; }
  setGroups(groups: string[]): void { this.rowGroups = groups; this.onGroupChanged(groups); }
  setDarkMode(dark: boolean): void { this.darkMode = dark; }

  // ─── Context Menu Actions ───────────────────────────────────────

  setGroupForRow(row: number, group: string): void {
    this.rowGroups[row] = group;
    this.onGroupChanged(this.rowGroups);
  }

  selectAllRows(): void {
    if (!this.dataMatrix) return;
    for (let i = 0; i < this.dataMatrix.nSamples; i++) this.selectedRows.add(i);
  }

  invertSelection(): void {
    if (!this.dataMatrix) return;
    for (let i = 0; i < this.dataMatrix.nSamples; i++) {
      if (this.selectedRows.has(i)) this.selectedRows.delete(i);
      else this.selectedRows.add(i);
    }
  }

  copySelection(): string {
    const rows = this.getSelectedRows();
    if (rows.length === 0 || !this.dataMatrix) return '';
    const lines: string[] = [];
    lines.push(this.dataMatrix.colLabels.join('\t'));
    for (const r of rows) {
      const vals = this.dataMatrix.data.row(r).map(v => isNaN(v) ? 'NA' : v.toString());
      lines.push([this.dataMatrix.rowLabels[r], ...vals].join('\t'));
    }
    return lines.join('\n');
  }

  // ─── Statistics for Selection ───────────────────────────────────

  getSelectionStats(): { count: number; mean: number; std: number } {
    const data = this.getSelectedData();
    if (data.length === 0) return { count: 0, mean: 0, std: 0 };
    const flat = data.flat().filter(v => !isNaN(v));
    const n = flat.length;
    if (n === 0) return { count: 0, mean: 0, std: 0 };
    const m = flat.reduce((a, b) => a + b, 0) / n;
    const s = Math.sqrt(flat.reduce((sum, v) => sum + (v - m) ** 2, 0) / (n - 1));
    return { count: n, mean: m, std: s };
  }
}
