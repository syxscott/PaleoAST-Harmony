@Component
export struct ExportDialog {
  @Link visible: boolean;
  @State formatIdx: number = 0;
  formatOpts: string[] = ['CSV', 'TSV'];
  @State includeLabels: boolean = true;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text('Export Data').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text('Format:').width(80).fontSize(13); Select(this.formatOpts.map((v,i) => ({value:v}))).selected(this.formatIdx).onSelect((idx:number) => { this.formatIdx = idx; }) }.width('100%').margin({ bottom: 8 })
      Row() { Checkbox().select(this.includeLabels).onChange((v:boolean) => { this.includeLabels = v; }); Text('Include labels').fontSize(13).margin({ left: 8 }) }.margin({ bottom: 16 })
      Divider().margin({ bottom: 12 })
      Row() {
        Button('Cancel').backgroundColor('#95A5A6').fontColor('#FFFFFF').onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button('Export').type(ButtonType.Capsule).backgroundColor('#27AE60').fontColor('#FFFFFF').onClick(() => { this.doRun(); this.visible = false; })
      }.width('100%').justifyContent(FlexAlign.End)
    }.padding(24).width(420).borderRadius(12)
  }
  doRun(): void { this.onConfirm({ format: this.formatOpts[this.formatIdx], includeLabels: this.includeLabels }); }
}
