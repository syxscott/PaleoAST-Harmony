/**
 * LoadingView — Loading animation overlay
 * Replaces inline @Builder LoadingView in Index.ets
 *
 * There is deliberately NO determinate progress bar here. `runAnalysisWithParams`
 * executes the analysis synchronously on the UI thread — closures capturing
 * component `this` cannot cross threads via taskpool, so the work blocks the
 * event loop and no intermediate frame can be painted. Any `Progress` fed by a
 * percentage would therefore either sit frozen or jump straight to 100, both of
 * which misdescribe what is happening.
 *
 * `Index.progress` existed for exactly that bar and was never assigned anywhere
 * in Index.ets, so the bar rendered at 0% for the whole of every analysis. The
 * indeterminate `LoadingProgress` spinner plus the status line ("Running: PCA…")
 * is the honest representation, and the dead percentage state is gone.
 */
@Component
export struct LoadingView {
  @Link statusText: string;

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
    }
    .width('100%')
    .layoutWeight(1)
    .justifyContent(FlexAlign.Center);
  }
}
