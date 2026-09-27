@Component
export struct BiostratDialog {
  @Link visible: boolean;
  // The "Method" selector (ua / rasc) is gone. `unitaryAssociations` — the only
  // function this dialog dispatches to — has no method parameter, and the value
  // was dropped by Index.ets, so choosing "rasc" silently ran unitary
  // associations anyway while the analysis script recorded the method.
  // min_occurrence is kept and is now actually forwarded (as
  // `minSectionOccurrence`).
  @State min_occurrence: number = 2;
  @State showTips: boolean = false;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("Biostrat").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Min occurrence:").width(140).fontSize(13); TextInput({ text: String(this.min_occurrence) }).width(100).type(InputType.Number).onChange((v: string) => { this.min_occurrence = parseInt(v) || 2; }) }.width("100%").margin({ bottom: 8 })
            Row() { Text("[+] Tips").fontSize(11).fontColor("#3498DB").onClick(() => { this.showTips = !this.showTips; }) }.width("100%").margin({ bottom: 8 })
      if (this.showTips) { Column() {
          Text("Unitary associations: cliques of co-occurring section and event taxa.").fontSize(10).fontColor("#7F8C8D").margin({ bottom: 2 })
      }.margin({ bottom: 8 }) }
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({ 'min_occurrence': this.min_occurrence }); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width('92%').constraintSize({ maxWidth: 450 }).borderRadius(12)
  }
}