/**
 * Extinction Confidence Intervals Dialog
 * Estimates true extinction timing from fossil LAD data.
 */
@Component
export struct ExtinctionDialog {
  @Link @Watch('onVisibleChange') visible: boolean;
  @State methodIdx: number = 0;
  @State confidence_level: number = 0.95;
  @State showAdvanced: boolean = false;
  methodOpts: string[] = ['marshall', 'strauss_sadler'];
  methodDesc: string[] = [
    'Marshall (1997): distribution-free, based on gap analysis',
    'Strauss-Sadler (1989): assumes uniform fossil distribution',
  ];
  onConfirm: (params: Record<string, Object>) => void = () => {};

  /**
   * Reset every parameter when the dialog is reopened.
   *
   * ArkUI keeps @State values across a visibility toggle, so before this the
   * numbers typed in an earlier session silently reappeared the next time the
   * dialog was opened — and a user who forgets they changed something reads the
   * stale value as the default. For a research tool that means silently wrong
   * results, so the state is restored to its declared defaults on every open.
   */
  onVisibleChange(): void {
    if (!this.visible) return;
    this.methodIdx = 0;
    this.confidence_level = 0.95;
    this.showAdvanced = false;
  }

  build() {
    Column() {
      Text('Extinction Confidence Intervals').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 8 })
      Text('Estimates true extinction timing beyond last appearance.').fontSize(11).fontColor($r('app.color.text_secondary')).margin({ bottom: 16 })

      Row() { Text('Method:').width(160).fontSize(13); Select(this.methodOpts.map((v, i) => ({ value: v }))).selected(this.methodIdx).onSelect((idx: number) => { this.methodIdx = idx; }) }.width('100%').margin({ bottom: 4 })
      Text(this.methodDesc[this.methodIdx]).fontSize(10).fontColor($r('app.color.text_muted')).margin({ bottom: 8 })

      Row() { Text('Confidence level:').width(160).fontSize(13); TextInput({ text: String(this.confidence_level) }).width(80).onChange((v: string) => { this.confidence_level = Math.max(0.5, Math.min(0.99, parseFloat(v) || 0.95)); }) }.width('100%').margin({ bottom: 8 })

      Row() { Text(this.showAdvanced ? '[-] Notes' : '[+] Notes').fontSize(11).fontColor($r('app.color.primary')).onClick(() => { this.showAdvanced = !this.showAdvanced; }) }.width('100%').margin({ bottom: 8 })
      if (this.showAdvanced) {
        Column() {
          Text('Data must be LAD (Last Appearance Datum) positions.').fontSize(10).fontColor($r('app.color.text_secondary')).margin({ bottom: 2 })
          Text('Strauss-Sadler assumes uniform preservation (rarely true).').fontSize(10).fontColor($r('app.color.text_secondary')).margin({ bottom: 2 })
          Text('Marshall is more robust to non-uniform preservation.').fontSize(10).fontColor($r('app.color.text_secondary'))
        }.margin({ bottom: 8 })
      }

      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button('Cancel').backgroundColor($r('app.color.bg_muted')).fontColor($r('app.color.text_on_accent')).onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button('Run Analysis').type(ButtonType.Capsule).backgroundColor($r('app.color.primary')).fontColor($r('app.color.text_on_accent')).onClick(() => { this.onConfirm({ method: this.methodOpts[this.methodIdx], confidence_level: this.confidence_level }); this.visible = false; })
      }.width('100%').justifyContent(FlexAlign.End)
    }.padding(24).width('92%').constraintSize({ maxWidth: 480 }).borderRadius(12)
  }
}