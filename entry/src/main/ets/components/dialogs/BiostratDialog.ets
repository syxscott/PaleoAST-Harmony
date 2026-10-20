@Component
export struct BiostratDialog {
  @Link @Watch('onVisibleChange') visible: boolean;
  // The "Method" selector (ua / rasc) is gone. `unitaryAssociations` — the only
  // function this dialog dispatches to — has no method parameter, and the value
  // was dropped by Index.ets, so choosing "rasc" silently ran unitary
  // associations anyway while the analysis script recorded the method.
  // min_occurrence is kept and is now actually forwarded (as
  // `minSectionOccurrence`).
  @State min_occurrence: number = 2;
  @State showTips: boolean = false;
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
    this.min_occurrence = 2;
    this.showTips = false;
  }

  build() {
    Column() {
      Text("Biostrat").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Min occurrence:").width(140).fontSize(13); TextInput({ text: String(this.min_occurrence) }).width(100).type(InputType.Number).onChange((v: string) => { this.min_occurrence = parseInt(v) || 2; }) }.width("100%").margin({ bottom: 8 })
            Row() { Text("[+] Tips").fontSize(11).fontColor($r('app.color.primary')).onClick(() => { this.showTips = !this.showTips; }) }.width("100%").margin({ bottom: 8 })
      if (this.showTips) { Column() {
          Text("Unitary associations: cliques of co-occurring section and event taxa.").fontSize(10).fontColor($r('app.color.text_secondary')).margin({ bottom: 2 })
      }.margin({ bottom: 8 }) }
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor($r('app.color.bg_muted')).fontColor($r('app.color.text_on_accent')).onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor($r('app.color.primary')).fontColor($r('app.color.text_on_accent')).onClick(() => { this.onConfirm({ 'min_occurrence': this.min_occurrence }); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width('92%').constraintSize({ maxWidth: 450 }).borderRadius(12)
  }
}