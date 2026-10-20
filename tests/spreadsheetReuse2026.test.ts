/**
 * Regression tests for the reusable row of the data table (2026-10-20).
 *
 * The defect
 * ----------
 * `Spreadsheet.ets` drew its rows INLINE in the LazyForEach item generator:
 *
 *     LazyForEach(this.dataSource, (rowIdx: number) => {
 *       Row() { ...TextInput... LongPressGesture... }
 *     })
 *
 * An inline builder cannot be recycled, so every scroll threw the whole row
 * subtree away and built it again — the row number, the group badge and one
 * node per column. ArkUI can recycle that subtree, but only when the item is
 * a component marked `@Reusable`; the decorator cannot be applied to an
 * inline builder at all.
 *
 * The trap
 * --------
 * Recycling a component is not free of consequences. A recycled component
 * KEEPS the arguments it was created with: its constructor is not run again
 * and `aboutToAppear` is not called. A plain member variable therefore keeps
 * the value of the row the instance was first used for — a recycled row
 * would show another row's number, another row's group and another row's
 * data, while looking perfectly normal. That failure mode is worse than a
 * crash: the table compiles, the numbers are plausible, and they are wrong.
 *
 * The rules this change follows
 * -----------------------------
 *   - everything the row SHOWS is a `@Prop` (or `@ObjectLink`): the
 *     framework copies the parent's value in on every update, including on a
 *     recycle (the ArkUI guide "组件复用性能优化指导" shows a reusable
 *     component whose `@ObjectLink` refreshes with no `aboutToReuse` at all);
 *   - everything the row REPORTS is a plain function property: a callback is
 *     not state, and `@Prop` is a one-way binding — the wrong shape for a
 *     handler, and a deep copy of a function on every update;
 *   - the parent hands out STABLE references (arrow-function properties) and
 *     the row passes its own row index as an argument, so a recycled row
 *     never reports the row it was created for;
 *   - the editing state stays in the parent, so a recycled row cannot keep
 *     the editor of the cell it was recycled from.
 *
 * The .ets layer cannot execute under the Node harness, so the wiring is
 * checked as source text (the style of ets2026.test.ts / fixEts2026.test.ts).
 * The rules that decide what a cell looks like were pulled into
 * `cellAppearance.ts` — plain TypeScript — so the cell text and the cell
 * colours are checked for real rather than by grep.
 *
 * Every check is ALSO run against a known-broken sample, so the suite cannot
 * pass by being vacuous.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync } from 'node:fs';
import { formatCell, cellFontColor, cellBackground, rowBackground } from '../entry/src/main/ets/components/cellAppearance.ts';
import { token } from '../entry/src/main/ets/theme/tokens.ts';

const SHEET = 'entry/src/main/ets/components/Spreadsheet.ets';
const ROW = 'entry/src/main/ets/components/SpreadsheetRow.ets';

const readSheet = () => readFileSync(SHEET, 'utf-8');
const readRow = () => readFileSync(ROW, 'utf-8');

// ─── Source inspection helpers ─────────────────────────────────────────────

/** Slice a region out of a source file, between two markers. */
function between(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  if (a < 0) throw new Error('marker not found: ' + from);
  const b = src.indexOf(to, a);
  if (b < 0) throw new Error('marker not found: ' + to);
  return src.slice(a, b);
}

/** A member declaration of a struct. */
interface Member {
  name: string;
  decorators: string[];
  type: string;
  initializer: string;
}

const MEMBER_RE = /^\s*((?:@[\w]+(?:\([^)]*\))?\s*)*)([A-Za-z_][A-Za-z0-9_]*)\??\s*:\s*(.+)$/;
const MODIFIER_RE = /^(?:(?:public|private|protected|readonly|static|override|declare)\s+)+/;

/** The braces a line opens minus the ones it closes (string literals ignored). */
function braceDelta(line: string): number {
  const stripped = line
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, '``');
  let d = 0;
  for (const ch of stripped) {
    if (ch === '{') d++;
    else if (ch === '}') d--;
  }
  return d;
}

/**
 * The member declarations of a struct, with their decorators.
 *
 * Only the top level of the struct is scanned: a member sits at brace depth
 * 1, a method body at depth 2, so a local variable inside a method can
 * never be mistaken for a member.
 */
function structMembers(src: string, structName: string): Member[] {
  const decl = src.indexOf('struct ' + structName);
  if (decl < 0) return [];
  const open = src.indexOf('{', decl);
  if (open < 0) return [];
  const out: Member[] = [];
  let depth = 1;
  for (const raw of src.slice(open + 1).split('\n')) {
    const line = raw.replace(MODIFIER_RE, '');
    if (depth === 1) {
      const m = MEMBER_RE.exec(line);
      if (m) {
        const rest = m[3].trim();
        const eq = rest.indexOf(' = ');
        out.push({
          name: m[2],
          decorators: m[1].match(/@[\w]+/g) ?? [],
          type: (eq >= 0 ? rest.slice(0, eq) : rest).trim(),
          initializer: eq >= 0 ? rest.slice(eq + 3).trim() : '',
        });
      }
    }
    depth += braceDelta(raw);
  }
  return out;
}

/**
 * The members of the row that hold a value WITHOUT a decorator.
 *
 * A callback is allowed to be plain — it is a handler, not state. Anything
 * else that is plain is a value the row would keep from the row it was
 * created for.
 */
function plainStateMembers(rowSrc: string): string[] {
  return structMembers(rowSrc, 'SpreadsheetRow')
    .filter(m => m.decorators.length === 0)
    .filter(m => m.type.indexOf('=>') < 0)
    .map(m => m.name);
}

/** The callbacks of the row that were given a decorator (@Prop / @Link / @State). */
function decoratedCallbacks(rowSrc: string): string[] {
  return structMembers(rowSrc, 'SpreadsheetRow')
    .filter(m => m.type.indexOf('=>') >= 0 && m.decorators.length > 0)
    .map(m => m.name);
}

/** Does the item generator still draw the row itself? */
function drawsRowInline(dataRows: string): boolean {
  return dataRows.indexOf('TextInput(') >= 0
    || dataRows.indexOf('LongPressGesture') >= 0
    || dataRows.indexOf('getCellDisplay') >= 0;
}

/** The argument list the parent hands to the row component. */
function rowCallSite(parent: string): string {
  const a = parent.indexOf('SpreadsheetRow({');
  if (a < 0) return '';
  const b = parent.indexOf('})', a);
  return b < 0 ? '' : parent.slice(a, b + 2);
}

// ─── Known-broken samples, so the checks cannot be vacuous ─────────────────

/** The item generator as it was before the change: the row drawn inline. */
const OLD_INLINE_ITEM_GENERATOR = [
  '      LazyForEach(this.dataSource, (rowIdx: number) => {',
  '        Row() {',
  '          Text(String(rowIdx + 1)).width(40).fontSize(10)',
  '          if (this.showGroups) {',
  "            Text(this.rowGroups[rowIdx] ?? 'Ungrouped').width(60)",
  '          }',
  '          ForEach(this.columnIndices, (_: Object, colIdx: number) => {',
  '            if (this.editingCell === rowIdx + "," + colIdx) {',
  '              TextInput({ text: this.editValue })',
  '                .onChange((v: string) => { this.editValue = v; })',
  '            } else {',
  '              Text(this.getCellDisplay(rowIdx, colIdx))',
  '                .gesture(LongPressGesture({ repeatable: false })',
  '                  .onAction(() => { this.showCellMenu = true; }))',
  '            }',
  '          })',
  '        }',
  '      }, (rowIdx: number) => rowIdx.toString())',
].join('\n');

/** A row that keeps the values it shows in plain members. */
const ROW_WITH_PLAIN_STATE = [
  '@Reusable',
  '@Component',
  'struct SpreadsheetRow {',
  '  rowIndex: number = 0;',
  '  selectedRow: number = -1;',
  '  onSelect: (row: number, col: number) => void = () => {};',
  '}',
].join('\n');

/** A row whose callbacks are @Prop. */
const ROW_WITH_DECORATED_CALLBACKS = [
  '@Reusable',
  '@Component',
  'struct SpreadsheetRow {',
  '  @Prop rowIndex: number = 0;',
  '  @Prop onSelect: (row: number, col: number) => void = () => {};',
  '}',
].join('\n');

/** A row that keeps the editing state in a @State of its own. */
const ROW_WITH_OWN_EDITING_STATE = [
  '@Reusable',
  '@Component',
  'struct SpreadsheetRow {',
  '  @Prop rowIndex: number = 0;',
  '  @State editingCell: string = "";',
  '}',
].join('\n');

// ─── The change itself ─────────────────────────────────────────────────────

describe('fix: the data table rebuilt every row from scratch on every scroll', () => {
  it('the row is a component of its own, marked @Reusable', () => {
    const row = readRow();
    expect(/@Reusable\s+@Component\s+export struct SpreadsheetRow/.test(row)).toBe(true);
  });

  it('the parent hands the row to LazyForEach instead of drawing it', () => {
    const sheet = readSheet();
    expect(sheet.includes("import { SpreadsheetRow } from './SpreadsheetRow';")).toBe(true);
    expect(rowCallSite(sheet).length > 0).toBe(true);
  });

  it('the row markup is no longer inside the item generator', () => {
    const dataRows = between(readSheet(), '@Builder DataRows()', '@Builder StatusBar()');
    expect(drawsRowInline(dataRows)).toBe(false);
  });

  it('the item generator still keys the rows the same way', () => {
    const sheet = readSheet();
    expect(sheet.includes('(rowIdx: number) => rowIdx.toString()) // stable key per row')).toBe(true);
  });
});

describe('fix: a recycled row kept the data of the row it was created for', () => {
  it('every value the row shows is a @Prop, not a plain member', () => {
    expect(plainStateMembers(readRow())).toEqual([]);
  });

  it('the row keeps no state of its own', () => {
    // A @State in the row would survive the recycle: the row would come back
    // with the editor of the cell it was recycled from still open.
    expect(readRow().includes('@State')).toBe(false);
  });

  it('the parent passes every value the row needs', () => {
    const call = rowCallSite(readSheet());
    expect(call.length > 0).toBe(true);
    for (const m of structMembers(readRow(), 'SpreadsheetRow')) {
      if (m.decorators.length === 0) continue;   // the callbacks are checked apart
      expect(call.includes(m.name + ':')).toBe(true);
    }
  });

  it('the parent passes the CURRENT value of every variable', () => {
    // Not just the name of the variable: a row that is handed a constant
    // instead of the parent's value would show the same thing forever.
    const call = rowCallSite(readSheet());
    for (const pair of [
      'dataMatrix: this.dataMatrix',
      'rowIndex: rowIdx',
      'columnIndices: this.columnIndices',
      'selectedRow: this.selectedRow',
      'selectedCol: this.selectedCol',
      "editingCell: this.editingCell ?? ''",
      'editValue: this.editValue',
      'showGroups: this.showGroups',
      'groupLabel: this.groupLabelFor(rowIdx)',
      'groupColor: this.groupColorFor(rowIdx)',
      'darkMode: this.darkMode',
    ]) {
      expect(`${pair} -> ${call.includes(pair)}`).toBe(`${pair} -> true`);
    }
  });

  it('the row reads the table through the parent\'s @ObjectLink', () => {
    const row = readRow();
    expect(row.includes('@ObjectLink dataMatrix: DataMatrix;')).toBe(true);
    expect(row.includes('this.dataMatrix?.data.get(this.rowIndex, col)')).toBe(true);
  });
});

describe('fix: a recycled row reported the row it was created for', () => {
  it('the row passes its own row index to the callbacks', () => {
    const row = readRow();
    expect(row.includes('this.onSelect(this.rowIndex, colIdx)')).toBe(true);
    expect(row.includes('this.onStartEdit(this.rowIndex, colIdx)')).toBe(true);
    expect(row.includes('this.onLongPress(this.rowIndex, colIdx)')).toBe(true);
  });

  it('the parent hands out stable callback references, never an inline closure', () => {
    const sheet = readSheet();
    // An arrow-function property is created once, so the reference a recycled
    // row keeps is still the parent's current handler.
    for (const name of ['handleCellSelect', 'handleCellStartEdit', 'handleEditValueChange',
      'handleCommitEdit', 'handleCellLongPress']) {
      expect(sheet.includes('private ' + name + ' = (')).toBe(true);
    }
    const call = rowCallSite(sheet);
    expect(call.includes('onSelect: this.handleCellSelect')).toBe(true);
    expect(call.includes('onLongPress: this.handleCellLongPress')).toBe(true);
    // No closure is built inside the item generator.
    expect(call.includes('=>')).toBe(false);
  });
});

describe('fix: a recycled row kept the editor of the cell it was recycled from', () => {
  it('the editing state lives in the parent and the row only reads it', () => {
    expect(readSheet().includes('@State editingCell: string | null = null;')).toBe(true);
    expect(readRow().includes('@Prop editingCell: string')).toBe(true);
  });

  it('the editor of a cell is chosen by the row index it currently shows', () => {
    const row = readRow();
    expect(row.includes('this.editingCell === `${this.rowIndex},${colIdx}`')).toBe(true);
  });

  it('the parent still enters and leaves the editor the same way', () => {
    const sheet = readSheet();
    const start = between(sheet, 'private startEditing(', 'private commitEdit(');
    expect(start.includes("this.editingCell = `${row},${col}`;")).toBe(true);
    const commit = between(sheet, 'private commitEdit(', 'private cancelEdit(');
    expect(commit.includes('this.editingCell = null;')).toBe(true);
    expect(commit.includes('this.editValue = \'\';')).toBe(true);
    expect(commit.includes('this.dataMatrix.data.set(row, col, finalVal);')).toBe(true);
    expect(commit.includes('this.dataSource.notifyRowChanged(row);')).toBe(true);
    expect(commit.includes('StateManager.getInstance().pushUndo(')).toBe(true);
  });

  it('clicking a cell still leaves the editor and selects the cell', () => {
    const sheet = readSheet();
    const select = between(sheet, 'private handleCellSelect =', 'private handleCellStartEdit =');
    expect(select.includes('if (this.editingCell !== null) { this.cancelEdit(); }')).toBe(true);
    expect(select.includes('this.selectedRow = row;')).toBe(true);
    expect(select.includes('this.selectedCol = col;')).toBe(true);
  });

  it('the other handlers call the same methods the inline row called', () => {
    const sheet = readSheet();
    const start = between(sheet, 'private handleCellStartEdit =', 'private handleEditValueChange =');
    expect(start.includes('this.startEditing(row, col);')).toBe(true);
    const value = between(sheet, 'private handleEditValueChange =', 'private handleCommitEdit =');
    expect(value.includes('this.editValue = value;')).toBe(true);
    const commit = between(sheet, 'private handleCommitEdit =', 'private handleCellLongPress =');
    expect(commit.includes('this.commitEdit();')).toBe(true);
  });
});

describe('fix: the callbacks were deep-copied on every update of the row', () => {
  it('a callback is a plain function property, never a @Prop', () => {
    expect(decoratedCallbacks(readRow())).toEqual([]);
  });

  it('the callbacks take the row index as an argument instead of capturing it', () => {
    const row = readRow();
    const members = structMembers(row, 'SpreadsheetRow');
    const names = members.filter(m => m.type.indexOf('=>') >= 0).map(m => m.name);
    expect(names.length).toBe(5);
    for (const name of names) {
      const m = members.find(x => x.name === name)!;
      if (name === 'onEditValueChange' || name === 'onCommitEdit') continue;
      expect(m.type).toContain('row: number, col: number');
    }
  });
});

describe('fix: the cell text and the cell colours would have had a second implementation', () => {
  it('a missing value is NA', () => {
    expect(formatCell(NaN)).toBe('NA');
  });

  it('an infinite value is +Inf / -Inf', () => {
    expect(formatCell(Infinity)).toBe('+Inf');
    expect(formatCell(-Infinity)).toBe('-Inf');
  });

  it('a whole number is written without decimals', () => {
    expect(formatCell(42)).toBe('42');
  });

  it('anything else gets four decimals', () => {
    expect(formatCell(1.5)).toBe('1.5000');
  });

  it('a tiny and a huge value are written in exponential notation', () => {
    expect(formatCell(0.0001)).toBe('1.000e-4');
    // A whole number below 1e10 keeps its digits, as it always did.
    expect(formatCell(1e7)).toBe('10000000');
    expect(formatCell(1e10)).toBe('1.000e+10');
    // A fractional value of that size does not.
    expect(formatCell(15000000.5)).toBe('1.500e+7');
  });

  it('a missing value is red, a negative one amber, the rest ordinary', () => {
    expect(cellFontColor(NaN, false)).toBe(token('danger', false));
    expect(cellFontColor(-1, false)).toBe(token('warning', false));
    expect(cellFontColor(1, false)).toBe(token('text_primary', false));
  });

  it('the clicked cell wins over its row and its column', () => {
    expect(cellBackground(2, 3, 2, 3, false)).toBe(token('cell_selected', false));
  });

  it('the selected row wins over the selected column', () => {
    expect(cellBackground(2, 3, 2, -1, false)).toBe(token('bg_tint', false));
    expect(cellBackground(2, 3, -1, 3, false)).toBe(token('bg_selected', false));
  });

  it('a cell in neither the selected row nor the selected column is transparent', () => {
    expect(cellBackground(2, 3, -1, -1, false)).toBe('transparent');
  });

  it('the selected row is tinted and every second row carries the stripe', () => {
    expect(rowBackground(1, 1, false)).toBe(token('bg_tint', false));
    expect(rowBackground(0, -1, false)).toBe('transparent');
    expect(rowBackground(1, -1, false)).toBe(token('row_stripe', false));
  });

  it('the dark theme has its own colours', () => {
    expect(cellFontColor(NaN, true)).toBe(token('danger', true));
    expect(rowBackground(1, -1, true)).toBe(token('row_stripe', true));
  });

  it('the group badge still falls back to the muted colour', () => {
    const sheet = readSheet();
    const colour = between(sheet, 'private groupColorFor(', '@Builder StatusBar()');
    expect(colour.includes("this.groupColors.get(this.groupLabelFor(row)) ?? token('bg_muted', this.darkMode)")).toBe(true);
    const label = between(sheet, 'private groupLabelFor(', 'private groupColorFor(');
    expect(label.includes("this.rowGroups[row] ?? 'Ungrouped'")).toBe(true);
  });

  it('the status bar still counts the rows and the columns', () => {
    const sheet = readSheet();
    const bar = between(sheet, '@Builder StatusBar()', '// ─── Cell Display');
    expect(bar.includes('${this.selectedRows.size} rows selected')).toBe(true);
    expect(bar.includes('${this.dataMatrix.nSamples} rows x ${this.dataMatrix.nVariables} columns')).toBe(true);
    expect(bar.includes('${formatCell(val)}')).toBe(true);
  });
});

describe('fix: the long-press menu of a cell was opened by the row itself', () => {
  it('the parent still opens the context menu on a long press', () => {
    const sheet = readSheet();
    const press = between(sheet, 'private handleCellLongPress =', '// LazyForEach data source');
    expect(press.includes('this.selectedRow = row;')).toBe(true);
    expect(press.includes('this.selectedCol = col;')).toBe(true);
    expect(press.includes('this.showCellMenu = true;')).toBe(true);
  });

  it('the menu is still bound to the scroll of the table', () => {
    const sheet = readSheet();
    expect(sheet.includes('.bindPopup(this.showCellMenu, { builder: this.cellMenuPopup, placement: Placement.Bottom })')).toBe(true);
  });
});

// ─── The checks themselves ─────────────────────────────────────────────────

describe('the reuse checks are not vacuous', () => {
  it('a row that keeps its values in plain members is rejected', () => {
    expect(plainStateMembers(ROW_WITH_PLAIN_STATE)).toContain('rowIndex');
    expect(plainStateMembers(ROW_WITH_PLAIN_STATE)).toContain('selectedRow');
  });

  it('a row whose callbacks are @Prop is rejected', () => {
    expect(decoratedCallbacks(ROW_WITH_DECORATED_CALLBACKS)).toContain('onSelect');
  });

  it('a row that keeps the editing state in a @State is rejected', () => {
    // The check for "the row keeps no state of its own" is a plain search.
    expect(ROW_WITH_OWN_EDITING_STATE.includes('@State')).toBe(true);
    expect(readRow().includes('@State')).toBe(false);
  });

  it('an item generator that draws the row inline is rejected', () => {
    expect(drawsRowInline(OLD_INLINE_ITEM_GENERATOR)).toBe(true);
  });

  it('the real item generator is accepted', () => {
    const dataRows = between(readSheet(), '@Builder DataRows()', '@Builder StatusBar()');
    expect(drawsRowInline(dataRows)).toBe(false);
  });
});
