/**
 * Diagnostic Console — replaces views/diagnostic_console.py (361 lines)
 * Log viewer with filtering and export.
 */
@Component
export struct DiagnosticConsole {
  @State logs: LogEntry[] = [];
  @State filterLevel: string = 'ALL';
  @State filterText: string = '';
  @State autoScroll: boolean = true;

  build() {
    Column() {
      // Toolbar
      Row() {
        Select([{ value: 'ALL' }, { value: 'INFO' }, { value: 'WARN' }, { value: 'ERROR' }])
          .selected(0).onSelect((idx: number) => { this.filterLevel = ['ALL','INFO','WARN','ERROR'][idx]; })
        TextInput({ placeholder: 'Filter...' }).width(150).onChange((v: string) => { this.filterText = v; })
        Button('Clear').fontSize(10).onClick(() => { this.logs = []; })
        Button('Export').fontSize(10).onClick(() => { this.exportLogs(); })
        Blank()
        Text(this.logs.length + ' entries').fontSize(10).fontColor('#7F8C8D')
      }.width('100%').height(32).padding(4).backgroundColor('#F8F9FA')

      // Log entries
      List({ space: 1 }) {
        ForEach(this.getFilteredLogs(), (entry: LogEntry) => {
          ListItem() {
            Row() {
              Text(entry.timestamp).fontSize(10).fontFamily('monospace').fontColor('#7F8C8D').width(80)
              Text(entry.level).fontSize(10).fontFamily('monospace').fontColor(this.getLevelColor(entry.level)).width(50)
              Text(entry.message).fontSize(10).fontFamily('monospace').fontColor('#2C3E50').layoutWeight(1)
            }.width('100%').padding({ left: 4, right: 4 })
          }
        })
      }.width('100%').layoutWeight(1).scrollBar(BarState.Auto)
    }.width('100%').height('100%')
  }

  log(level: string, message: string): void {
    const now = new Date();
    const ts = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0');
    this.logs.push({ timestamp: ts, level, message });
  }

  private getFilteredLogs(): LogEntry[] {
    return this.logs.filter(l => {
      if (this.filterLevel !== 'ALL' && l.level !== this.filterLevel) return false;
      if (this.filterText && !l.message.includes(this.filterText)) return false;
      return true;
    });
  }

  private getLevelColor(level: string): string {
    switch (level) {
      case 'ERROR': return '#E74C3C';
      case 'WARN': return '#F39C12';
      case 'INFO': return '#3498DB';
      default: return '#7F8C8D';
    }
  }

  private exportLogs(): void {
    const text = this.logs.map(l => l.timestamp + ' [' + l.level + '] ' + l.message).join('
');
    console.log('Export logs: ' + text.substring(0, 100) + '...');
  }
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}
