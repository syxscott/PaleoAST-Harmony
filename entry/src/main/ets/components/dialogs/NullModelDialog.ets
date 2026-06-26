@Component
export struct NullModelDialog {
  @Link visible: boolean;
@State metricIdx: number = 0;
  metricOpts: string[] = ["c_score","checkerboard"];
  @State nPerm: number = 999;
  @State nWorkers: number = 4;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text('Null Model').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })

      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button("Cancel").backgroundColor("#95A5A6").fontColor("#FFFFFF").onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button("Run Analysis").type(ButtonType.Capsule).backgroundColor("#3498DB").fontColor("#FFFFFF").onClick(() => { this.doRun(); this.visible = false; })
      }.width("100%").justifyContent(FlexAlign.End)
    }.padding(24).width(450).borderRadius(12)
  }
  doRun(): void { this.onConfirm({}); }
}
