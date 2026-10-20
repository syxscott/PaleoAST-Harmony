import { DataMatrix } from "../../core/models/index";
import { cellBackground, cellFontColor, formatCell, rowBackground } from './cellAppearance';

/**
 * SpreadsheetRow — one row of the data table, as a reusable component.
 *
 * Why the row is its own component
 * --------------------------------
 * The rows used to be written inline in `Spreadsheet`'s LazyForEach item
 * generator, so every scroll threw the whole row subtree away and built it
 * again (row number + group badge + one node per column). ArkUI can recycle
 * that subtree instead, but only when the item is a component marked
 * `@Reusable` — the decorator cannot be applied to an inline builder.
 *
 * Why every value is a @Prop
 * --------------------------
 * A recycled component keeps the arguments it was created with: its
 * constructor is NOT run again and `aboutToAppear` is NOT called. A plain
 * member variable would therefore keep the value of the row the instance was
 * first used for — a recycled row would show another row's number, another
 * row's group and another row's data.
 *
 * `@Prop` (and `@ObjectLink`) are the exception: the framework copies the
 * parent's value into them on every update, including when the instance is
 * recycled. The ArkUI guide "组件复用性能优化指导" shows a reusable
 * component whose `@ObjectLink` data refreshes with no `aboutToReuse` at
 * all, and calls writing to such a variable inside `aboutToReuse`
 * "多余的刷新". So every value that can change while the row is alive is a
 * `@Prop`, and the row keeps no state of its own.
 *
 * Why the callbacks are plain function properties
 * ------------------------------------------------
 * A callback is not state: deep-copying it on every update would be pure
 * waste, and `@Prop` is a one-way binding, which is the wrong shape for a
 * handler. The callbacks are therefore ordinary members. For that to be
 * safe, the parent hands out *stable* references (arrow-function
 * properties, never an inline closure) and the row passes its own row
 * index as an argument — so a recycled row always reports the row it now
 * shows, never the row it was created for.
 *
 * The editing state lives in the parent (`Spreadsheet.editingCell`), so a
 * recycled row cannot keep the editor of the cell it was recycled from: it
 * only reads the parent's `editingCell` through a `@Prop`.
 */
@Reusable
@Component
export struct SpreadsheetRow {
  /** The table the row belongs to — the values are read from here. */
  @ObjectLink dataMatrix: DataMatrix;
  /** Which row of the table this is. */
  @Prop rowIndex: number = 0;
  /** The columns to draw. */
  @Prop columnIndices: number[] = [];
  /** The row the user has selected, or -1. */
  @Prop selectedRow: number = -1;
  /** The column the user has selected, or -1. */
  @Prop selectedCol: number = -1;
  /** The cell being edited, as "row,col"; '' when nothing is being edited. */
  @Prop editingCell: string = '';
  /** The text the user is typing into the edited cell. */
  @Prop editValue: string = '';
  /** Whether the group column is shown at all. */
  @Prop showGroups: boolean = true;
  /** This row's group label. */
  @Prop groupLabel: string = 'Ungrouped';
  /** The background colour of this row's group badge. */
  @Prop groupColor: string = '';
  /** The theme the table is drawn in. */
  @Prop darkMode: boolean = false;

  // ─── Callbacks ─────────────────────────────────────────────────────
  // Plain function properties, NOT @Prop: they are not state, and the
  // parent passes stable references that never capture a row index.

  /** A cell was clicked: select it, and leave the editor if one was open. */
  onSelect: (row: number, col: number) => void = () => {};
  /** A cell was double-clicked: start editing it. */
  onStartEdit: (row: number, col: number) => void = () => {};
  /** The text in the editor changed. */
  onEditValueChange: (value: string) => void = () => {};
  /** The editor was submitted: write the value back. */
  onCommitEdit: () => void = () => {};
  /** A cell was long-pressed: select it and open the context menu. */
  onLongPress: (row: number, col: number) => void = () => {};

  build() {
    Row() {
      // Row number
      Text(String(this.rowIndex + 1)).width(40).fontSize(10).textAlign(TextAlign.Center)
        .fontColor($r('app.color.text_secondary'))
        .backgroundColor(this.selectedRow === this.rowIndex ? $r('app.color.bg_tint') : 'transparent')

      // Group indicator
      if (this.showGroups) {
        Text(this.groupLabel).width(60).fontSize(9).textAlign(TextAlign.Center)
          .fontColor($r('app.color.text_on_accent'))
          .backgroundColor(this.groupColor)
          .borderRadius(4).padding(2)
      }

      // Data cells — use pre-computed columnIndices; TextInput while editing
      ForEach(this.columnIndices, (_: Object, colIdx: number) => {
        if (this.editingCell === `${this.rowIndex},${colIdx}`) {
          TextInput({ text: this.editValue })
            .width(80).height(20).fontSize(10)
            .onChange((v: string) => { this.onEditValueChange(v); })
            .onSubmit(() => { this.onCommitEdit(); })
        } else {
          Text(this.getCellDisplay(colIdx))
            .width(80).fontSize(10).textAlign(TextAlign.Right)
            .fontColor(this.getCellFontColor(colIdx))
            .backgroundColor(this.getCellBg(colIdx))
            .onClick(() => { this.onSelect(this.rowIndex, colIdx); })
            .onDoubleClick(() => { this.onStartEdit(this.rowIndex, colIdx); })
            .gesture(LongPressGesture({ repeatable: false })
              .onAction(() => { this.onLongPress(this.rowIndex, colIdx); }))
        }
      })
    }
    .width('100%').height(22)
    .backgroundColor(rowBackground(this.rowIndex, this.selectedRow, this.darkMode))
  }

  // ─── Cell appearance ───────────────────────────────────────────────

  private getCellDisplay(col: number): string {
    const val = this.dataMatrix?.data.get(this.rowIndex, col) ?? NaN;
    return formatCell(val);
  }

  private getCellFontColor(col: number): string {
    const val = this.dataMatrix?.data.get(this.rowIndex, col) ?? NaN;
    return cellFontColor(val, this.darkMode);
  }

  private getCellBg(col: number): string {
    return cellBackground(this.rowIndex, col, this.selectedRow, this.selectedCol, this.darkMode);
  }
}
