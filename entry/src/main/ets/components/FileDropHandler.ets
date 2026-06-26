/**
 * File Drop Handler — replaces views/file_drop_handler.py (227 lines)
 * Handles drag-and-drop file loading.
 */
@Component
export struct FileDropHandler {
  @State isDragging: boolean = false;
  @State dragFilePath: string = '';

  onFileLoaded: (path: string, content: string) => void = () => {};
  onError: (message: string) => void = () => {};

  build() {
    Column() {
      if (this.isDragging) {
        Column() {
          Text('[Drop]').fontSize(32).fontColor('#3498DB')
          Text('Drop file here').fontSize(14).fontColor('#7F8C8D')
        }.width('100%').height('100%').justifyContent(FlexAlign.Center)
          .border({ width: 2, color: '#3498DB', style: BorderStyle.Dashed })
      } else {
        Text('').width('100%').height('100%')
      }
    }.width('100%').height('100%')
  }

  canHandle(path: string): boolean {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    return ['csv', 'tsv', 'txt', 'tps', 'nxs', 'nex', 'tre', 'newick', 'dat'].includes(ext);
  }

  getFileType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = { csv: 'CSV', tsv: 'CSV', tps: 'TPS', nxs: 'Nexus', nex: 'Nexus', tre: 'Newick', newick: 'Newick', dat: 'DAT' };
    return map[ext] ?? 'Unknown';
  }
}
