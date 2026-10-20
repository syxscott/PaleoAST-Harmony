import { DataMatrix, StateManager } from "../../core/models/index";
import { SpreadsheetDataSource } from "./SpreadsheetDataSource";
import { Matrix } from "../../core/math/Matrix";
import { EventBus } from "../../core/utils/EventBus";
import { blankGroups, fitGroups, cycleGroup, UNGROUPED } from "./rowGroups";
import { token } from '../theme/tokens';

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
    ['Group_A', token('primary', this.darkMode)], ['Group_B', token('danger', this.darkMode)], ['Group_C', token('success', this.darkMode)],
    ['Group_D', token('warning', this.darkMode)], ['Ungrouped', token('bg_muted', this.darkMode)],
  ]);
  @State rowGroups: string[] = []; // group label per row
  // @Prop（非 @State）：跟随父级（WorkspaceView/Index）主题切换实时联动
  @Prop darkMode: boolean = false;
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
  // 编辑回写撤销栈所需：记录进入编辑时的原始值
  private editingOldValue: number = NaN;
  // 数据被外部改变（撤销/重做/重新加载）时的刷新订阅
  private dataChangedHandler = (): void => { this.onExternalDataChanged(); };
  // 换了一张表（重新导入）时的订阅：分组标签属于旧表，必须清空
  private datasetLoadedHandler = (): void => { this.resetGroups(); };

  aboutToAppear(): void {
    if (this.dataMatrix) {
      this.rowGroups = blankGroups(this.dataMatrix.nSamples);
    }
    this.initColumnIndices();
    this.recomputeRows();
    // 撤销/重做/重新加载后由 Index 经 EventBus 通知，这里刷新行缓存与网格
    EventBus.getInstance().on('data_changed', this.dataChangedHandler);
    // 重新导入是"换了一张表"，不是"这张表被改了"：分组必须重置
    EventBus.getInstance().on('dataset_loaded', this.datasetLoadedHandler);
  }

  aboutToDisappear(): void {
    EventBus.getInstance().off('data_changed', this.dataChangedHandler);
    EventBus.getInstance().off('dataset_loaded', this.datasetLoadedHandler);
  }

  /**
   * 外部数据变更（undo/redo/加载新文件）→ 重建行缓存并刷新整表。
   *
   * 分组标签在这里按行号保留：撤销/重做改的是同一张表，分组必须留下。
   * "换了一张表"由 resetGroups() 单独处理——两者都是 'data_changed'，
   * 在这里无法区分。
   */
  private onExternalDataChanged(): void {
    this.initColumnIndices();
    this.rowGroups = this.dataMatrix
      ? fitGroups(this.rowGroups, this.dataMatrix.nSamples)
      : [];
    this.recomputeRows();
    this.dataSource.setRowIndices(this.filteredRowsCache);
  }

  /**
   * 换了一张表：旧分组属于旧数据，按行号继承到新表就是错的。
   *
   * 旧行为：新表仍然显示旧表的 Group_A / Group_B（按行号继承），用户在新表
   * 里点一次 "Set Group"，整份数组（含旧标签）就被写进新表的 rowMeta——
   * 新表继承了旧分组，之后 ANOSIM / PERMANOVA / SIMPER / LDA 算出来的
   * p 值与新数据毫无关系，而界面上看不出任何异常。
   *
   * 这里把标签清空（空数组 = 每行都是 Ungrouped），不依赖当前的行数：
   * 事件是在父组件换掉 @ObjectLink 之前同步送达的，此时本组件读到的
   * 可能还是旧矩阵。
   */
  private resetGroups(): void {
    this.rowGroups = [];
    this.selectedRows = new Set<number>();
    this.selectedRow = -1;
    this.recomputeRows();
    this.dataSource.setRowIndices(this.filteredRowsCache);
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

      // ─── 冻结表头（openharmony-sheet 象限模型：表头固定，正文独立滚动） ───
      this.HeaderRow()

      // ─── Data Grid ───
      Scroll() {
        Column() {
          // Data rows（长按单元格 → 上下文菜单）
          this.DataRows()
        }
      }
      .layoutWeight(1)
      .width('100%')
      .bindPopup(this.showCellMenu, { builder: this.cellMenuPopup, placement: Placement.Bottom })

      // ─── Status Bar ───
      this.StatusBar()
    }.width('100%').height('100%')
    .backgroundColor($r('app.color.start_window_background'))
  }

  // ─── 长按单元格上下文菜单（openharmony-sheet click-cell 模式） ─────────
  @State showCellMenu: boolean = false;

  @Builder cellMenuPopup() {
    Column() {
      Text(`Cell ${this.selectedRow >= 0 ? this.selectedRow + 1 : '-'}, ${this.selectedCol >= 0 ? this.selectedCol + 1 : '-'}`)
        .fontSize(10).fontColor($r('app.color.text_secondary')).margin({ bottom: 6 })
      Button('Copy value').fontSize(11).height(26).width('100%').backgroundColor('transparent').fontColor($r('app.color.text_primary'))
        .onClick(() => {
          if (this.dataMatrix && this.selectedRow >= 0 && this.selectedCol >= 0) {
            const v = this.dataMatrix.data.get(this.selectedRow, this.selectedCol);
            this.editValue = isNaN(v) ? 'NA' : String(v);
            this.copyCellToClipboard(this.editValue);
          }
          this.showCellMenu = false;
        })
      Button('Assign next group').fontSize(11).height(26).width('100%').backgroundColor('transparent').fontColor($r('app.color.text_primary'))
        .onClick(() => {
          if (this.selectedRow >= 0) { this.assignGroup(); }
          this.showCellMenu = false;
        })
      Button('Mark as NA').fontSize(11).height(26).width('100%').backgroundColor('transparent').fontColor($r('app.color.danger'))
        .onClick(() => {
          if (this.dataMatrix && this.selectedRow >= 0 && this.selectedCol >= 0) {
            const old = this.dataMatrix.data.get(this.selectedRow, this.selectedCol);
            StateManager.getInstance().pushUndo(this.selectedRow, this.selectedCol, old, NaN);
            StateManager.getInstance().markModified();
            this.dataMatrix.data.set(this.selectedRow, this.selectedCol, NaN);
            this.dataSource.notifyRowChanged(this.selectedRow);
          }
          this.showCellMenu = false;
        })
    }
    .padding(10)
    .borderRadius(8)
    .backgroundColor($r('app.color.bg_active'))
  }

  private copyCellToClipboard(text: string): void {
    // 剪贴板 API 在页面层接入；表格内先落到状态栏可见的暂存值
    this.statusCellText = text;
  }
  @State statusCellText: string = '';

  @Builder Toolbar() {
    Row() {
      if (this.showGroups) {
        Text('Groups:').fontSize(11).fontColor($r('app.color.text_secondary')).margin({ right: 4 })
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
    .backgroundColor($r('app.color.bg_secondary'))
    .border({ width: { bottom: 1 }, color: token('border_light', this.darkMode) })
  }

  @Builder HeaderRow() {
    Row() {
      // Row number header
      Text('#').width(40).fontSize(10).fontWeight(FontWeight.Bold)
        .textAlign(TextAlign.Center).fontColor($r('app.color.text_primary'))

      // Group column (if enabled)
      if (this.showGroups) {
        Text('Group').width(60).fontSize(10).fontWeight(FontWeight.Bold)
          .textAlign(TextAlign.Center).fontColor($r('app.color.text_primary'))
      }

      // Column headers
      if (this.dataMatrix != null) {
        ForEach(this.dataMatrix.colLabels, (label: string, colIdx: number) => {
          Text(label).width(80).fontSize(10).fontWeight(FontWeight.Bold)
            .textAlign(TextAlign.Center)
            .fontColor(this.sortColumn === colIdx ? token('primary', this.darkMode) : (token('text_primary', this.darkMode)))
            .backgroundColor(this.sortColumn === colIdx ? $r('app.color.bg_tint') : 'transparent')
            .onClick(() => {
              if (this.sortColumn === colIdx) { this.sortAscending = !this.sortAscending; }
              else { this.sortColumn = colIdx; this.sortAscending = true; }
            })
        })
      }
    }
    .width('100%').height(26)
    .backgroundColor($r('app.color.bg_header'))
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
            .fontColor($r('app.color.text_secondary'))
            .backgroundColor(this.selectedRow === rowIdx ? $r('app.color.bg_tint') : 'transparent')

          // Group indicator
          if (this.showGroups) {
            Text(this.rowGroups[rowIdx] ?? 'Ungrouped').width(60).fontSize(9).textAlign(TextAlign.Center)
              .fontColor($r('app.color.text_on_accent'))
              .backgroundColor(this.groupColors.get(this.rowGroups[rowIdx] ?? 'Ungrouped') ?? token('bg_muted', this.darkMode))
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
                .gesture(LongPressGesture({ repeatable: false })
                  .onAction(() => { this.selectedRow = rowIdx; this.selectedCol = colIdx; this.showCellMenu = true; }))
            }
          })
        }
        .width('100%').height(22)
        .backgroundColor(this.selectedRow === rowIdx ? token('bg_tint', this.darkMode) : (rowIdx % 2 === 0 ? 'transparent' : (token('row_stripe', this.darkMode))))
      }, (rowIdx: number) => rowIdx.toString()) // stable key per row
    }
  }

  @Builder StatusBar() {
    Row() {
      if (this.statusCellText.length > 0) {
        Text('Copied: ' + this.statusCellText)
          .fontSize(11).fontColor($r('app.color.primary'))
      } else if (this.selectedRow >= 0 && this.selectedCol >= 0) {
        const val = this.dataMatrix?.data.get(this.selectedRow, this.selectedCol) ?? NaN;
        Text(`Row ${this.selectedRow + 1}, Col ${this.selectedCol + 1}: ${this.formatCell(val)}`)
          .fontSize(11).fontColor($r('app.color.text_secondary'))
      } else if (this.dataMatrix != null) {
        Text(`${this.dataMatrix.nSamples} rows x ${this.dataMatrix.nVariables} columns`)
          .fontSize(11).fontColor($r('app.color.text_secondary'))
      }
      Blank()
      if (this.selectedRows.size > 0) {
        Text(`${this.selectedRows.size} rows selected`).fontSize(11).fontColor($r('app.color.text_secondary'))
      }
    }
    .width('100%').height(24).padding({ left: 8, right: 8 })
    .backgroundColor($r('app.color.bg_secondary'))
    .border({ width: { top: 1 }, color: token('border_light', this.darkMode) })
  }

  // ─── Cell Display ───────────────────────────────────────────────

  private getCellDisplay(row: number, col: number): string {
    const val = this.dataMatrix?.data.get(row, col) ?? NaN;
    return this.formatCell(val);
  }

  private getCellFontColor(row: number, col: number): string {
    const val = this.dataMatrix?.data.get(row, col) ?? NaN;
    if (isNaN(val)) return token('danger', this.darkMode);
    if (val < 0) return token('warning', this.darkMode);
    return token('text_primary', this.darkMode);
  }

  private getCellBg(row: number, col: number): string {
    if (row === this.selectedRow && col === this.selectedCol) return token('cell_selected', this.darkMode);
    if (row === this.selectedRow) return token('bg_tint', this.darkMode);
    if (col === this.selectedCol) return token('bg_selected', this.darkMode);
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
    this.editingOldValue = val; // 记录原值供撤销栈使用
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
      // 写入撤销栈（单元格级 delta），使编辑可被 Undo/Redo 回退
      StateManager.getInstance().pushUndo(row, col, this.editingOldValue, finalVal);
      StateManager.getInstance().markModified();
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
    // One label per row of the CURRENT table. The array published to the
    // DataMatrix must never carry a previous table's labels, and it must
    // have exactly one entry per row, or setGroups() would write the tail
    // of an older (longer) table into the new one.
    const labels = fitGroups(this.rowGroups, this.dataMatrix?.nSamples ?? 0);
    const currentGroup = labels[this.selectedRow] ?? UNGROUPED;
    // Rotate to the next group (unknown label → start with the first group)
    labels[this.selectedRow] = cycleGroup(currentGroup, groups);
    this.rowGroups = labels;
    this.onGroupChanged(this.rowGroups);
  }

  private clearGroups(): void {
    this.rowGroups = blankGroups(this.dataMatrix?.nSamples ?? 0);
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
    this.rowGroups = blankGroups(this.dataMatrix.nSamples);
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
  setGroups(groups: string[]): void {
    // Exactly one label per row: an array of the wrong length would either
    // drop labels or write a previous table's labels into this one.
    this.rowGroups = fitGroups(groups, this.dataMatrix?.nSamples ?? 0);
    this.onGroupChanged(this.rowGroups);
  }
  setDarkMode(dark: boolean): void { this.darkMode = dark; }

  // ─── Context Menu Actions ───────────────────────────────────────

  setGroupForRow(row: number, group: string): void {
    const labels = fitGroups(this.rowGroups, this.dataMatrix?.nSamples ?? 0);
    if (row < 0 || row >= labels.length) return;
    labels[row] = group;
    this.rowGroups = labels;
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
