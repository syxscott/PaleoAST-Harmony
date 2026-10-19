/**
 * Regression tests: reporting / export defects found in the 2026-10-19 audit.
 *
 * Every test name STATES THE OLD BEHAVIOUR, so a reader can tell what was
 * broken without git history. The LaTeX findings were reproduced with the
 * real toolchain (TeX Live 2025, `pdflatex`):
 *
 *  - raw Windows path in \includegraphics → "Undefined control sequence."
 *    (12 occurrences, exit code 1, NO pdf)
 *  - LaTeX-escaped path → "Missing endcsname inserted" (exit code 1), the
 *    file name looked for is `C\textbackslash{}Users…`
 *  - \detokenize{…} → exit code 0, pdf produced
 *  - row with more cells than the header → "Extra alignment tab has been
 *    changed to \cr" (exit code 1)
 *  - table environment inside a table environment → "LaTeX Error: Not in
 *    outer par mode." (exit code 1)
 *
 * These tests stay toolchain-independent (string assertions), so they run
 * everywhere; the pdflatex numbers above are recorded in the change report.
 */
import { describe, it, expect } from './runner.ts';

import { Matrix } from '../entry/src/main/core/math/Matrix.ts';
import { ReportBuilder } from '../entry/src/main/core/reporting/ReportBuilder.ts';
import { compileLaTeX } from '../entry/src/main/core/reporting/LatexCompiler.ts';
import { TableGenerator } from '../entry/src/main/core/reporting/TableGenerator.ts';
import { MatrixConverter } from '../entry/src/main/core/reporting/MatrixConverter.ts';
import { FigureHandler } from '../entry/src/main/core/reporting/FigureHandler.ts';
import { FilePickerHelper } from '../entry/src/main/core/io/FilePickerHelper.ts';

/** Run `fn` and return the error message; fails when nothing was thrown. */
function errorOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('expected the call to throw, but it returned normally');
}

async function rejectionOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('expected the promise to reject, but it resolved');
}

describe('reporting 2026: the LaTeX export dropped the report title', () => {
  it('compileLaTeX wrote an empty \\title{} when opts.title was empty', () => {
    // The production export path (Index.ets) sets the title on the builder
    // and never passed one to compileLaTeX, so every exported .tex had an
    // empty title and the PDF title page had no title — silently, exit 0.
    const rb = new ReportBuilder();
    rb.setTitle('PaleoAST export');
    const res = compileLaTeX(rb, {});
    expect(res.success).toBe(true);
    expect(res.texContent.includes('\\title{PaleoAST export}')).toBe(true);

    const m = /\\title\{([^}]*)\}/.exec(res.texContent);
    expect(m !== null).toBe(true);
    expect((m![1]).trim().length > 0).toBe(true);
  });

  it('compileLaTeX still prefers an explicitly passed title', () => {
    const rb = new ReportBuilder();
    rb.setTitle('Builder title');
    const res = compileLaTeX(rb, { title: 'Explicit title' });
    expect(res.texContent.includes('\\title{Explicit title}')).toBe(true);
    expect(res.texContent.includes('\\title{Builder title}')).toBe(false);
  });
});

describe('reporting 2026: the HTML table writer used the LaTeX escaper', () => {
  it('TableGenerator.html left "<script>" as a live tag and "&" as a LaTeX escape', () => {
    const m = new Matrix(new Float64Array([1, 2]), 1, 2);
    const html = TableGenerator.html(m, ['<script>alert(1)</script>', 'a & b']);

    // The old output was: <th><script>alert(1)</script></th> — a live tag.
    expect(html.includes('<script')).toBe(false);
    expect(html.includes('</script')).toBe(false);
    expect(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(true);

    // The old output was `a \& b` (a LaTeX escape), not an HTML entity.
    expect(html.includes('&amp;')).toBe(true);
    expect(html.includes('\\&')).toBe(false);
  });

  it('the shared HTML escaper is the one used by every HTML writer', () => {
    const rb = new ReportBuilder();
    rb.setTitle('<script>x</script>');
    expect(rb.toHTML().includes('<script>x</script>')).toBe(false);

    const fh = new FigureHandler();
    fh.add('a.png', '<script>x</script>');
    expect(fh.toHTML().includes('<script>x</script>')).toBe(false);
  });
});

describe('reporting 2026: table column counts were never checked', () => {
  it('tableFromMatrix produced a .tex that pdflatex rejects ("Extra alignment tab")', () => {
    const msg = errorOf(() => ReportBuilder.tableFromMatrix(['A', 'B'], [[1, 2, 3]]));
    expect(msg.includes('column count mismatch')).toBe(true);
    expect(msg.includes('2 header column')).toBe(true);
    expect(msg.includes('3 cell')).toBe(true);
  });

  it('TableGenerator.latex produced a .tex that pdflatex rejects ("Extra alignment tab")', () => {
    const m = new Matrix(new Float64Array([1, 2, 3]), 1, 3);
    const msg = errorOf(() => TableGenerator.latex(m, ['a', 'b']));
    expect(msg.includes('column count mismatch')).toBe(true);
    expect(msg.includes('2 header column')).toBe(true);
    expect(msg.includes('3 column')).toBe(true);
  });

  it('a matching table is still accepted', () => {
    const m = new Matrix(new Float64Array([1, 2]), 1, 2);
    // TableGenerator adds a leading row-label column, hence three columns.
    expect(TableGenerator.latex(m, ['a', 'b']).includes('\\begin{tabular}{lll}')).toBe(true);
    expect(ReportBuilder.tableFromMatrix(['A', 'B'], [[1, 2]]).includes('\\begin{tabular}{ll}')).toBe(true);
  });
});

describe('reporting 2026: the 95% CI was dropped from the LaTeX and HTML tables', () => {
  const withCI = (): ReportBuilder => {
    const rb = new ReportBuilder();
    rb.addStatisticalResult({
      testName: 't-test', statistic: 2.1, pValue: 0.03, df: 10,
      effectSize: 0.5, ciLower: 0.12, ciUpper: 1.1,
    });
    return rb;
  };

  it('the LaTeX statistics table had five columns and no CI', () => {
    const tex = withCI().toLaTeX();
    expect(tex.includes('\\begin{tabular}{llllll}')).toBe(true);
    expect(tex.includes('95\\% CI')).toBe(true);
    expect(tex.includes('[0.1200, 1.1000]')).toBe(true);
  });

  it('the compiled .tex statistics table had five columns and no CI', () => {
    const tex = compileLaTeX(withCI(), {}).texContent;
    expect(tex.includes('\\begin{tabular}{llllll}')).toBe(true);
    expect(tex.includes('95\\% CI')).toBe(true);
    expect(tex.includes('[0.1200, 1.1000]')).toBe(true);
  });

  it('the HTML statistics table had five columns and no CI', () => {
    const html = withCI().toHTML();
    expect(html.includes('<th>95% CI</th>')).toBe(true);
    expect(html.includes('[0.1200, 1.1000]')).toBe(true);
  });

  it('a result without a CI still shows the placeholder', () => {
    const rb = new ReportBuilder();
    rb.addStatisticalResult({ testName: 't-test', statistic: 2.1 });
    expect(rb.toHTML().includes('<td>--</td>')).toBe(true);
  });
});

describe('reporting 2026: the figure path was pasted raw into \\includegraphics', () => {
  it('FigureHandler.toLatex emitted a raw Windows path (pdflatex: Undefined control sequence)', () => {
    const fh = new FigureHandler();
    fh.add('C:\\Users\\paleo\\fig1.png', 'caption');
    const tex = fh.toLatex();

    // The old output contained the path verbatim, so the backslashes were
    // read as control sequences: "Undefined control sequence." x12, no pdf.
    expect(tex.includes('\\detokenize{')).toBe(true);
    expect(tex.includes('\\detokenize{C:\\Users\\paleo\\fig1.png}')).toBe(true);
    expect(tex.includes('\\textbackslash{}')).toBe(false);
  });

  it('the LaTeX-escaped path was not a fix either (the macro is expanded)', () => {
    const rb = new ReportBuilder();
    rb.addFigure('C:\\Users\\paleo\\fig1.png', 'caption');
    const tex = rb.toLaTeX();
    expect(tex.includes('\\detokenize{C:\\Users\\paleo\\fig1.png}')).toBe(true);
    expect(tex.includes('\\textbackslash{}')).toBe(false);

    const compiled = compileLaTeX(rb, {}).texContent;
    expect(compiled.includes('\\detokenize{C:\\Users\\paleo\\fig1.png}')).toBe(true);
    expect(compiled.includes('\\textbackslash{}')).toBe(false);
  });
});

describe('reporting 2026: a failed export write was reported as "cancelled"', () => {
  it('saveVia resolved to null (i.e. "cancelled") when the write failed', async () => {
    // Under the node harness fs.openSync refuses to run, which is exactly a
    // failed write: the error must reach the caller, not become a null.
    const msg = await rejectionOf(() =>
      FilePickerHelper.saveVia(async () => 'file://report.tex', () => { throw new Error('ENOSPC'); }));
    expect(msg.length > 0).toBe(true);
  });

  it('a cancelled save still resolves to null', async () => {
    const uri = await FilePickerHelper.saveVia(async () => null, () => { throw new Error('must not be called'); });
    expect(uri).toBeNull();
  });

  it('a picker failure is not mistaken for a cancellation', () => {
    expect(FilePickerHelper.isUserCancel({ code: 13900012, message: 'cancel' })).toBe(true);
    expect(FilePickerHelper.isUserCancel(new Error('user cancelled the dialog'))).toBe(true);
    expect(FilePickerHelper.isUserCancel(new Error('ENOSPC: no space left on device'))).toBe(false);
    expect(FilePickerHelper.isUserCancel({ code: 13900042, message: 'file access failed' })).toBe(false);
  });
});

describe('reporting 2026: a missing value was typeset as "NaN"', () => {
  it('tableFromMatrix wrote the JavaScript artefact "NaN" into the table', () => {
    const tex = ReportBuilder.tableFromMatrix(['Length', 'Width'], [[1.5, NaN]]);
    expect(tex.includes('NaN')).toBe(false);
    expect(tex.includes('1.500 & NA \\\\')).toBe(true);
  });

  it('TableGenerator.latex wrote "NaN" into the table', () => {
    const m = new Matrix(new Float64Array([1.5, NaN]), 1, 2);
    const tex = TableGenerator.latex(m, ['Length', 'Width']);
    expect(tex.includes('NaN')).toBe(false);
    expect(tex.includes('1.500 & NA \\\\')).toBe(true);

    const md = TableGenerator.markdown(m, ['Length', 'Width']);
    expect(md.includes('NaN')).toBe(false);
    expect(md.includes('1.5 | NA')).toBe(true);
  });

  it('the CSV export of the same missing value is "NA" as well', () => {
    const m = new Matrix(new Float64Array([NaN]), 1, 1);
    // The convention comes from core/parsers/CSVParser.toCSV ("NA"); the
    // table writers now use the same spelling.
    expect(MatrixConverter.formatCell(NaN)).toBe('NA');
    expect(Number.isNaN(m.get(0, 0))).toBe(true);
  });
});

describe('reporting 2026: a complete table environment was nested in a second one', () => {
  it('addTable wrapped TableGenerator.latex output in another table (Not in outer par mode)', () => {
    const rb = new ReportBuilder();
    rb.addTable(TableGenerator.latex(new Matrix(new Float64Array([1, 2]), 1, 2), ['a', 'b']), 'cap');

    const tex = rb.toLaTeX();
    expect(tex.split('\\begin{table}').length - 1).toBe(1);
    expect(tex.split('\\end{table}').length - 1).toBe(1);
    expect(tex.includes('\\caption{cap}')).toBe(true);
    expect(tex.includes('\\begin{tabular}{lll}')).toBe(true);

    const compiled = compileLaTeX(rb, {}).texContent;
    expect(compiled.split('\\begin{table}').length - 1).toBe(1);
    expect(compiled.split('\\end{table}').length - 1).toBe(1);
  });

  it('a plain fragment is still wrapped exactly once', () => {
    const rb = new ReportBuilder();
    rb.addTable(ReportBuilder.tableFromMatrix(['A', 'B'], [[1, 2]]), 'cap');
    const tex = rb.toLaTeX();
    expect(tex.split('\\begin{table}').length - 1).toBe(1);
    expect(tex.split('\\end{table}').length - 1).toBe(1);
    expect(tex.includes('\\caption{cap}')).toBe(true);
  });
});
