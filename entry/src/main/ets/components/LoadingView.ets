/**
 * LoadingView — Loading animation overlay
 * Replaces inline @Builder LoadingView in Index.ets
 */
@Component
export struct LoadingView {
  @Link statusText: string;
  @Link progress: number;

  build() {
    Column() {
      LoadingProgress()
        .width(48)
        .height(48)
        .color('#3498DB');

      Text(this.statusText)
        .fontSize(13)
        .fontColor('#7F8C8D')
        .margin({ top: 16 });

      Progress({ value: this.progress, total: 100, type: ProgressType.Linear })
        .width('60%')
        .margin({ top: 8 })
        .color('#3498DB');
    }
    .width('100%')
    .layoutWeight(1)
    .justifyContent(FlexAlign.Center);
  }
}
