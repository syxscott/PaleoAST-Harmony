@Component
export struct AnosimDialog {
  @Link visible: boolean;
  @State n_permutations: number = 999;
  @State metricIdx: number = 0;
  metricOpts: string[] = ["bray_curtis", "euclidean"];
  @State showTips: boolean = false;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("ANOSIM").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 8 })
      Text("Tests group differences via distance matrix.").fontSize(11).fontColor("#7F8C8D").margin({ bottom: 16 })
      Row() { Text("Permutations:").width(140).fontSize(13); TextInput({ text: String(this.n_permutations) }).width(100).type(InputType.Number).onChange((v: string) => { this.n_permutations = parseInt(v) || 999; }) }.width("100%").margin({ bottom: 8 })
      Row() { Text("Metric:").width(140).fontSize(13); Select(this.metricOpts.map((v, i) => ({ value: v }))).selected(this.metricIdx).onSelect((idx: number) => { this.metricIdx = idx; }) }.width("100%").margin({ bottom: 8 })
            Row() { Text("[+] Tips").fontSize(11).fontColor("#3498DB").onClick(() => { this.showTips = !this.showTips; }) }.width("100%").margin({ bottom: 8 })
      if (this.showTips) { Column() {
          Text("R > 1: strong separation").fontSize(10).fontColor("#7F8C8D").margin({ bottom: 2 })
          Text("R ~ 0: no separation").fontSize(10).fontColor("#7F8C8D").margin({ bottom: 2 })
      }.margin({ bottom: 8 }) }
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'n_permutations': this.n_permutations, 'metric': this.metricOpts[this.metricIdx]}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}