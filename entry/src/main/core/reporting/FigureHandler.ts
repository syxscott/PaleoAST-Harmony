/**
 * Figure handler — replaces reporting/figure_handler.py.
 *
 * Manages a list of figures with captions and references; produces LaTeX figure
 * environments and Markdown image links for inclusion in a report.
 */
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

  /** Markdown-formatted image links. */
  toMarkdown(): string {
    return this.figures.map(f => `![${f.caption}](${f.path})`).join('\n\n');
  }

  /** HTML <img> tags wrapped in <figure>. */
  toHTML(): string {
    return this.figures.map(f => `<figure><img src="${f.path}" alt="${f.caption}"/><figcaption>${f.caption}</figcaption></figure>`).join('\n');
  }

  private _escape(s: string): string {
    return s.replace(/[\\$&%#_{}~^]/g, c => `\\${c}`);
  }
}
