import { DataMatrix } from "../../core/data/index";
import { Matrix } from "../../core/math/Matrix";

/**
 * Scientific Spreadsheet Component — replaces views/ui_spreadsheet.py
 * Full-featured data table with:
 * - Cell editing
 * - Row/column selection
 * - Group assignment (colored row labels)
 * - Sorting by column
 * - Filtering
 * - NaN/missing value display
 * - Context menu for group operations
 */
@Component
export struct Spreadsheet {
  @Prop dataMatrix: DataMatrix | null = null;
  @State selectedRow: number = -1;
  @State selectedCol: number = -1;
  @State selectedRows: Set<number> = new Set();
  @State sortColumn: number = -1;
  @State sortAscending: boolean = true;
  @State filterText: string = '';
  @State editingCell: string = ''; // "row,col"
  @State editValue: string = '';
  @State groupColors: Map<string, string> = new Map([
    ['Group_A', '#3498DB'], ['Group_B', '#E74C3C'], ['Group_C', '#27AE60'],
    ['Group_D', '#F39C12'], ['Ungrouped', '#95A5A6'],
  ]);
  @State rowGroups: string[] = []; // group label per row
  @State darkMode: boolean = false;
  @State showGroups: boolean = true;

  // Callbacks
  onDataChanged: (data: Matrix) => void = () => {};
  onSelectionChanged: (rows: number[], cols: number[]) => void = () => {};
  onGroupChanged: (groups: string[]) => void = () => {};

  aboutToAppear(): void {
    if (this.dataMatrix) {
      this.rowGroups = Array.from({ length: this.dataMatrix.nSamples }, () => 'Ungrouped');
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
        ForEach(this.dataMatrix!.colLabels, (label: string, colIdx: number) => {
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
      ForEach(this.getFilteredRows(), (rowIdx: number) => {
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

          // Data cells
          ForEach(Array.from({ length: this.dataMatrix!.nVariables }), (_: Object, colIdx: number) => {
            Text(this.getCellDisplay(rowIdx, colIdx))
              .width(80).fontSize(10).textAlign(TextAlign.Right)
              .fontColor(this.getCellFontColor(rowIdx, colIdx))
              .backgroundColor(this.getCellBg(rowIdx, colIdx))
              .onClick(() => { this.selectedRow = rowIdx; this.selectedCol = colIdx; })
              .onDoubleClick(() => { this.startEditing(rowIdx, colIdx); })
          })
        }
        .width('100%').height(22)
        .backgroundColor(this.selectedRow === rowIdx ? '#EBF5FB' : (rowIdx % 2 === 0 ? 'transparent' : (this.darkMode ? '#16213e08' : '#F8F9FA08')))
      })
    }
  }

  @Builder StatusBar() {
    Row() {
      if (this.selectedRow >= 0 && this.selectedCol >= 0) {
        const val = this.dataMatrix?.data.get(this.selectedRow, this.selectedCol) ?? NaN;
        Text(`Row ${this.selectedRow + 1}, Col ${this.selectedCol + 1}: ${this.formatCell(val)}`)
          .fontSize(11).fontColor('#7F8C8D')
      } else if (this.dataMatrix != null) {
        Text(`${this.dataMatrix!.nSamples} rows x ${this.dataMatrix!.nVariables} columns`)
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
    if (this.editingCell === `${row},${col}`) return this.editValue;
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

  // ─── Cell Editing ───────────────────────────────────────────────

  private startEditing(row: number, col: number): void {
    if (!this.dataMatrix) return;
    const val = this.dataMatrix.data.get(row, col);
    this.editValue = isNaN(val) ? '' : String(val);
    this.editingCell = `${row},${col}`;
  }

  private commitEdit(): void {
    const parts = this.editingCell.split(',');
    if (parts.length !== 2) return;
    const row = parseInt(parts[0]), col = parseInt(parts[1]);
    if (!this.dataMatrix) return;

    const newVal = this.editValue.trim().toLowerCase() === 'na' ? NaN : parseFloat(this.editValue);
    if (!isNaN(newVal) || this.editValue.trim().toLowerCase() === 'na') {
      this.dataMatrix.data.set(row, col, isNaN(newVal) ? NaN : newVal);
      this.onDataChanged(this.dataMatrix.data);
    }
    this.editingCell = '';
    this.editValue = '';
  }

  private cancelEdit(): void {
    this.editingCell = '';
    this.editValue = '';
  }

  // ─── Group Management ───────────────────────────────────────────

  private assignGroup(): void {
    if (this.selectedRow < 0) return;
    const groups = Object.keys(this.groupColors);
    const currentGroup = this.rowGroups[this.selectedRow] ?? 'Ungrouped';
    const nextIdx = (groups.indexOf(currentGroup) + 1) % groups.length;
    this.rowGroups[this.selectedRow] = groups[nextIdx];
    this.onGroupChanged(this.rowGroups);
  }

  private clearGroups(): void {
    this.rowGroups = Array.from({ length: this.dataMatrix?.nSamples ?? 0 }, () => 'Ungrouped');
    this.onGroupChanged(this.rowGroups);
  }

  // ─── Filtering ──────────────────────────────────────────────────

  private getFilteredRows(): number[] {
    if (!this.dataMatrix) return [];
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

    return rows;
  }

  // ─── Public API ─────────────────────────────────────────────────

  loadData(data: number[][], rowLabels: string[], colLabels: string[]): void {
    const dm = new DataMatrix(Matrix.from2D(data), rowLabels, colLabels);
    this.rowGroups = Array.from({ length: dm.nSamples }, () => 'Ungrouped');
    // Note: In real ArkUI, @Prop dataMatrix would be set by parent
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
}
