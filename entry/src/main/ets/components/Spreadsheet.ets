import { DataMatrix } from "../../core/data/index";

/**
 * Scientific Spreadsheet Component
 * Displays data matrix with row/column labels, supports editing,
 * group assignment, and selection.
 */
@Component
export struct Spreadsheet {
  @Link dataMatrix: DataMatrix | null;
  @State selectedRow: number = -1;
  @State selectedCol: number = -1;
  @State selectedRows: Set<number> = new Set();
  @State sortColumn: number = -1;
  @State sortAscending: boolean = true;
  @State filterText: string = '';
  @State editMode: boolean = false;
  @State cellValue: string = '';

  build() {
    Column() {
      // Toolbar
      Row() {
        Button('Add Row').fontSize(11).height(28).margin({ right: 4 })
        Button('Add Col').fontSize(11).height(28).margin({ right: 4 })
        Button('Delete').fontSize(11).height(28).margin({ right: 4 }).fontColor('#E74C3C')
        Blank()
        TextInput({ placeholder: 'Filter...' }).width(150).height(28).onChange(v => { this.filterText = v; })
      }.width('100%').padding(4).backgroundColor('#F8F9FA')

      // Data grid
      Scroll() {
        Column() {
          // Header row
          Row() {
            Text('#').width(40).fontSize(10).fontWeight(FontWeight.Bold).textAlign(TextAlign.Center)
            if (this.dataMatrix != null) {
              ForEach(this.dataMatrix!.colLabels, (label: string, colIdx: number) => {
                Text(label).width(80).fontSize(10).fontWeight(FontWeight.Bold).textAlign(TextAlign.Center)
                  .onClick(() => { this.sortColumn = colIdx; this.sortAscending = !this.sortAscending; })
              })
            }
          }.width('100%').height(24).backgroundColor('#E4E7EB')

          // Data rows
          if (this.dataMatrix != null) {
            ForEach(this.dataMatrix!.rowLabels, (label: string, rowIdx: number) => {
              Row() {
                Text(label).width(40).fontSize(10).textAlign(TextAlign.Center)
                  .backgroundColor(this.selectedRow === rowIdx ? '#EBF5FB' : 'transparent')
                ForEach(Array.from({ length: this.dataMatrix!.nVariables }), (_: Object, colIdx: number) => {
                  Text(this.formatCell(this.dataMatrix!.data.get(rowIdx, colIdx)))
                    .width(80).fontSize(10).textAlign(TextAlign.Right)
                    .backgroundColor(this.getCellBg(rowIdx, colIdx))
                    .onClick(() => { this.selectedRow = rowIdx; this.selectedCol = colIdx; })
                })
              }.width('100%').height(22)
            })
          }
        }
      }.layoutWeight(1).width('100%')

      // Status bar
      Row() {
        if (this.selectedRow >= 0 && this.selectedCol >= 0) {
          Text('Row: ' + (this.selectedRow + 1) + ', Col: ' + (this.selectedCol + 1) +
            ', Value: ' + this.formatCell(this.dataMatrix?.data.get(this.selectedRow, this.selectedCol) ?? 0))
            .fontSize(11).fontColor('#7F8C8D')
        } else if (this.dataMatrix != null) {
          Text(this.dataMatrix!.nSamples + ' rows x ' + this.dataMatrix!.nVariables + ' columns')
            .fontSize(11).fontColor('#7F8C8D')
        }
      }.width('100%').height(24).padding({ left: 8 })
    }.width('100%').height('100%')
  }

  private formatCell(value: number): string {
    if (isNaN(value)) return 'NA';
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(4);
  }

  private getCellBg(row: number, col: number): ResourceColor {
    if (row === this.selectedRow && col === this.selectedCol) return '#3498DB40';
    if (row === this.selectedRow) return '#EBF5FB';
    if (col === this.selectedCol) return '#FDF2E9';
    return 'transparent';
  }

  loadData(data: number[][], rowLabels: string[], colLabels: string[]): void {
    // Import from external source
  }

  getSelectedData(): number[][] {
    if (this.dataMatrix == null) return [];
    const rows = this.selectedRows.size > 0 ? Array.from(this.selectedRows) : [this.selectedRow];
    return rows.filter(r => r >= 0).map(r => this.dataMatrix!.data.row(r));
  }
}
