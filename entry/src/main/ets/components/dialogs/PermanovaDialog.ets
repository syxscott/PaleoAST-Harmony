@Component
export struct PermanovaDialog {
  @Link visible: boolean;
@State nPerm: number = 999;
  @State metricIdx: number = 0;
  metricOpts: string[] = ["bray_curtis","euclidean"];
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text('PERMANOVA').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })

      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.doRun(); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
  doRun(): void { this.onConfirm({}); }
}
