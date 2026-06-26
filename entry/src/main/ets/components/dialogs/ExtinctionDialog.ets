/**
 * Extinction Confidence Intervals Dialog
 * Estimates true extinction timing from fossil LAD data.
 */
@Component
export struct ExtinctionDialog {
  @Link visible: boolean;
  @State methodIdx: number = 0;
  @State confidence_level: number = 0.95;
  @State showAdvanced: boolean = false;
  methodOpts: string[] = ['marshall', 'strauss_sadler'];
  methodDesc: string[] = [
    'Marshall (1997): distribution-free, based on gap analysis',
    'Strauss-Sadler (1989): assumes uniform fossil distribution',
  ];
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text('Extinction Confidence Intervals').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 8 })
      Text('Estimates true extinction timing beyond last appearance.').fontSize(11).fontColor('#7F8C8D').margin({ bottom: 16 })

      Row() { Text('Method:').width(160).fontSize(13); Select(this.methodOpts.map((v, i) => ({ value: v }))).selected(this.methodIdx).onSelect((idx: number) => { this.methodIdx = idx; }) }.width('100%').margin({ bottom: 4 })
      Text(this.methodDesc[this.methodIdx]).fontSize(10).fontColor('#95A5A6').margin({ bottom: 8 })

      Row() { Text('Confidence level:').width(160).fontSize(13); TextInput({ text: String(this.confidence_level) }).width(80).onChange((v: string) => { this.confidence_level = Math.max(0.5, Math.min(0.99, parseFloat(v) || 0.95)); }) }.width('100%').margin({ bottom: 8 })

      Row() { Text(this.showAdvanced ? '[-] Notes' : '[+] Notes').fontSize(11).fontColor('#3498DB').onClick(() => { this.showAdvanced = !this.showAdvanced; }) }.width('100%').margin({ bottom: 8 })
      if (this.showAdvanced) {
        Column() {
          Text('Data must be LAD (Last Appearance Datum) positions.').fontSize(10).fontColor('#7F8C8D').margin({ bottom: 2 })
          Text('Strauss-Sadler assumes uniform preservation (rarely true).').fontSize(10).fontColor('#7F8C8D').margin({ bottom: 2 })
          Text('Marshall is more robust to non-uniform preservation.').fontSize(10).fontColor('#7F8C8D')
        }.margin({ bottom: 8 })
      }

      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button('Cancel').backgroundColor('#95A5A6').fontColor('#FFFFFF').onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button('Run Analysis').type(ButtonType.Capsule).backgroundColor('#3498DB').fontColor('#FFFFFF').onClick(() => { this.onConfirm({ method: this.methodOpts[this.methodIdx], confidence_level: this.confidence_level }); this.visible = false; })
      }.width('100%').justifyContent(FlexAlign.End)
    }.padding(24).width(480).borderRadius(12)
  }
}