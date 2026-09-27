/**
 * Null Model Analysis Dialog
 * Tests whether co-occurrence patterns differ from random expectation.
 */
@Component
export struct NullModelDialog {
  @Link @Watch('onVisibleChange') visible: boolean;
  @State metricIdx: number = 0;
  @State n_permutations: number = 999;
  // No "Parallel workers" field. `nullModel(presenceMatrix, metric, nPermutations)`
  // has no worker parameter, and the only parallel helper in the tree
  // (core/hpc/ProcessPool) has no caller, so the spinner could never have had an
  // effect. It was dropped at two levels — the dialog payload was never read and
  // StatisticsController.runNullModel's own `nWorkers` argument was never
  // forwarded — while still being written into the analysis script.
  @State showAdvanced: boolean = false;
  metricOpts: string[] = ['c_score', 'checkerboard', 'combo'];
  metricDesc: string[] = [
    'C-score (Stone & Roberts 1990): measures checkerboard structure',
    'Checkerboard: counts perfect checkerboard pairs',
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
    this.metricIdx = 0;
    this.n_permutations = 999;
    this.showAdvanced = false;
  }

  build() {
    Column() {
      Text('Null Model Analysis').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 8 })
      Text('Tests if species co-occurrence differs from random.').fontSize(11).fontColor('#7F8C8D').margin({ bottom: 16 })

      Row() { Text('Co-occurrence metric:').width(160).fontSize(13); Select(this.metricOpts.map((v, i) => ({ value: v }))).selected(this.metricIdx).onSelect((idx: number) => { this.metricIdx = idx; }) }.width('100%').margin({ bottom: 4 })
      Text(this.metricDesc[this.metricIdx]).fontSize(10).fontColor('#95A5A6').margin({ bottom: 8 })

      Row() { Text('Permutations:').width(160).fontSize(13); TextInput({ text: String(this.n_permutations) }).width(80).type(InputType.Number).onChange((v: string) => { this.n_permutations = Math.max(99, Math.min(9999, parseInt(v) || 999)); }) }.width('100%').margin({ bottom: 8 })

      Row() { Text(this.showAdvanced ? '[-] Interpretation guide' : '[+] Interpretation guide').fontSize(11).fontColor('#3498DB').onClick(() => { this.showAdvanced = !this.showAdvanced; }) }.width('100%').margin({ bottom: 8 })
      if (this.showAdvanced) {
        Column() {
          Text('SES > 2: Aggregated (species co-occur more than expected)').fontSize(10).fontColor('#27AE60').margin({ bottom: 2 })
          Text('SES < -2: Segregated (species avoid each other)').fontSize(10).fontColor('#E74C3C').margin({ bottom: 2 })
          Text('|SES| < 2: Random co-occurrence').fontSize(10).fontColor('#7F8C8D').margin({ bottom: 2 })
          Text('p < 0.05: Statistically significant pattern').fontSize(10).fontColor('#3498DB')
        }.margin({ bottom: 8 })
      }

      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button('Cancel').backgroundColor('#95A5A6').fontColor('#FFFFFF').onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button('Run Analysis').type(ButtonType.Capsule).backgroundColor('#3498DB').fontColor('#FFFFFF').onClick(() => { this.onConfirm({ metric: this.metricOpts[this.metricIdx], n_permutations: this.n_permutations }); this.visible = false; })
      }.width('100%').justifyContent(FlexAlign.End)
    }.padding(24).width('92%').constraintSize({ maxWidth: 480 }).borderRadius(12)
  }
}