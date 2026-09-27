/**
 * Figure handler — replaces reporting/figure_handler.py.
 *
 * Manages a list of figures with captions and references; produces LaTeX figure
 * environments and Markdown image links for inclusion in a report.
 */
import { escapeLatex } from './LatexCompiler';
export interface Figure {
  path: string;
  caption: string;
  label?: string;
  width?: number;   // LaTeX width = 0.9\linewidth by default
}

export class FigureHandler {
  figures: Figure[] = [];

  add(path: string, caption: string, label?: string): Figure {
    const f: Figure = { path, caption, label };
    this.figures.push(f);
    return f;
  }

  /** Render all figures into LaTeX figure environments. */
  toLatex(): string {
    return this.figures.map(f => {
      const w = f.width ?? 0.9;
      return [
        `\\begin{figure}[htbp]`,
        `\\centering`,
        `\\includegraphics[width=${w}\\linewidth]{${f.path}}`,
        `\\caption{${this._escape(f.caption)}}`,
        f.label ? `\\label{${f.label}}` : '',
        `\\end{figure}`
      ].filter(Boolean).join('\n');
    }).join('\n\n');
  }

  /**
   * HTML <img> tags wrapped in <figure>.
   *
   * `path` and `caption` used to be interpolated raw. A caption containing a
   * double quote closed the `alt` attribute early and everything after it became
   * live markup, and a caption containing `<script>` was emitted as a real tag:
   *
   *   add('C:\\path\\to<file>.png', 'caption with <script> & "quote"')
   *   -> <img src="C:\path\to<file>.png" alt="caption with <script> & "quote""/>
   *
   * Both attributes are now escaped, and figcaption text is escaped too.
   */
  toHTML(): string {
    return this.figures.map(f =>
      `<figure><img src="${this._escapeHTML(f.path)}" alt="${this._escapeHTML(f.caption)}"/>` +
      `<figcaption>${this._escapeHTML(f.caption)}</figcaption></figure>`).join('\n');
  }

  /** Markdown-formatted image links. */
  toMarkdown(): string {
    return this.figures.map(f => `![${this._escapeHTML(f.caption)}](${f.path})`).join('\n\n');
  }

  private _escapeHTML(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * LaTeX escaping.
   *
   * This was `s.replace(/[\\$&%#_{}~^]/g, c => '\\' + c)`, which is wrong for
   * `\`, `~` and `^`: they became `\\` (a line break), `\^` and `\~` (accent
   * macros), silently corrupting captions that mention a path or a superscript
   * while the document still compiled. LatexCompiler.escapeLatex handles all
   * three correctly, so this now shares that one implementation
   * (docs/code-style.md 1.4 — one quantity, one implementation).
   */
  private _escape(s: string): string {
    return escapeLatex(s);
  }
}
