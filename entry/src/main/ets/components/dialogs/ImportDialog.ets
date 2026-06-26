@Component
export struct ImportDialog {
  @Link visible: boolean;
  @State filePath: string = '';
  @State hasHeader: boolean = true;
  @State hasRowLabels: boolean = true;
  @State delimiterIdx: number = 0;
  delimiterOpts: string[] = ['Comma (,)', 'Tab (	)', 'Space'];
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text('Import Data').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text('File path:').width(80).fontSize(13); TextInput({ text: this.filePath }).width(280).onChange((v:string) => { this.filePath = v; }) }.width('100%').margin({ bottom: 8 })
      Row() { Text('Delimiter:').width(80).fontSize(13); Select(this.delimiterOpts.map((v,i) => ({value:v}))).selected(this.delimiterIdx).onSelect((idx:number) => { this.delimiterIdx = idx; }) }.width('100%').margin({ bottom: 8 })
      Row() { Checkbox().select(this.hasHeader).onChange((v:boolean) => { this.hasHeader = v; }); Text('Has header row').fontSize(13).margin({ left: 8 }) }.margin({ bottom: 8 })
      Row() { Checkbox().select(this.hasRowLabels).onChange((v:boolean) => { this.hasRowLabels = v; }); Text('Has row labels').fontSize(13).margin({ left: 8 }) }.margin({ bottom: 16 })
      Divider().margin({ bottom: 12 })
      Row() {
        Button('Cancel').backgroundColor('#95A5A6').fontColor('#FFFFFF').onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button('Import').type(ButtonType.Capsule).backgroundColor('#3498DB').fontColor('#FFFFFF').onClick(() => { this.doRun(); this.visible = false; })
      }.width('100%').justifyContent(FlexAlign.End)
    }.padding(24).width(480).borderRadius(12)
  }
  doRun(): void { this.onConfirm({ filePath: this.filePath, hasHeader: this.hasHeader, hasRowLabels: this.hasRowLabels, delimiter: this.delimiterOpts[this.delimiterIdx] }); }
}
