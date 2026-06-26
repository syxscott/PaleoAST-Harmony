@Component
export struct BiostratDialog {
  @Link visible: boolean;
  @State methodIdx: number = 0;
  methodOpts: string[] = ["ua", "rasc"];
  @State min_occurrence: number = 2;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("Biostrat").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Method:").width(140).fontSize(13); Select(this.methodOpts.map((v, i) => ({ value: v }))).selected(this.methodIdx).onSelect((idx: number) => { this.methodIdx = idx; }) }.width("100%").margin({ bottom: 8 })
      Row() { Text("Min occurrence:").width(140).fontSize(13); TextInput({ text: String(this.min_occurrence) }).width(100).type(InputType.Number).onChange((v: string) => { this.min_occurrence = parseInt(v) || 2; }) }.width("100%").margin({ bottom: 8 })
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'method': this.methodOpts[this.methodIdx], 'min_occurrence': this.min_occurrence}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}