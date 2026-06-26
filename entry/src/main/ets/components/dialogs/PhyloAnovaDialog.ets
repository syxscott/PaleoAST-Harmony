@Component
export struct PhyloAnovaDialog {
  @Link visible: boolean;
  @State n_permutations: number = 999;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text("Phylo ANOVA").fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text("Permutations:").width(140).fontSize(13); TextInput({ text: String(this.n_permutations) }).width(100).type(InputType.Number).onChange((v: string) => { this.n_permutations = parseInt(v) || 999; }) }.width("100%").margin({ bottom: 8 })
      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.onConfirm({'n_permutations': this.n_permutations}); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
}