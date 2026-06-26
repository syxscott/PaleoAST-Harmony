/**
 * Report builder ¡ª replaces reporting/report_builder.py
 * Generates reports in Markdown/HTML format.
 */

export class ReportBuilder {
  private _sections: string[] = [];
  private _title = '';

  setTitle(title: string): void { this._title = title; }
  addTitle(title: string): void { this._sections.push('# ' + title); }
  addSection(title: string, content: string): void { this._sections.push('## ' + title + '

' + content); }
  addText(text: string): void { this._sections.push(text); }

  addTable(headers: string[], rows: string[][]): void {
    let t = '| ' + headers.join(' | ') + ' |
| ' + headers.map(() => '---').join(' | ') + ' |';
    for (const row of rows) t += '
| ' + row.join(' | ') + ' |';
    this._sections.push(t);
  }

  addFigure(path: string, caption: string): void {
    this._sections.push('![' + caption + '](' + path + ')');
  }

  addCode(code: string, lang = ''): void {
    this._sections.push('```' + lang + '
' + code + '
```');
  }

  toMarkdown(): string { return this._sections.join('

'); }
  toHTML(): string {
    let html = this._sections.join('

');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    return '<html><body>' + html + '</body></html>';
  }
  clear(): void { this._sections = []; this._title = ''; }
  getSections(): string[] { return [...this._sections]; }
}
