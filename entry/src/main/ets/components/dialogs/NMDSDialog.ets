/**
 * NMDS Configuration Dialog
 * Non-metric Multidimensional Scaling with SMACOF algorithm.
 */
@Component
export struct NMDSDialog {
  @Link visible: boolean;
  @State n_dimensions: number = 2;
  @State n_restarts: number = 10;
  @State max_iterations: number = 300;
  @State metricIdx: number = 0;
  @State errorMsg: string = '';
  @State showAdvanced: boolean = false;
  metricOpts: string[] = ['bray_curtis', 'euclidean', 'jaccard'];
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text('NMDS — Non-metric Multidimensional Scaling').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 8 })
      Text('Robust ordination that preserves rank order of distances.').fontSize(11).fontColor('#7F8C8D').margin({ bottom: 16 })

      Row() { Text('Dimensions:').width(160).fontSize(13); TextInput({ text: String(this.n_dimensions) }).width(80).type(InputType.Number).onChange((v: string) => { const n = parseInt(v) || 2; if (n < 1 || n > 5) { this.errorMsg = 'Dimensions must be 1-5'; } else { this.n_dimensions = n; this.errorMsg = ''; } }) }.width('100%').margin({ bottom: 4 })
      if (this.errorMsg) { Text(this.errorMsg).fontSize(10).fontColor('#E74C3C').margin({ bottom: 8 }) }

      Row() { Text('Random restarts:').width(160).fontSize(13); TextInput({ text: String(this.n_restarts) }).width(80).type(InputType.Number).onChange((v: string) => { this.n_restarts = Math.max(1, Math.min(50, parseInt(v) || 10)); }) }.width('100%').margin({ bottom: 8 })
      Row() { Text('Max iterations:').width(160).fontSize(13); TextInput({ text: String(this.max_iterations) }).width(80).type(InputType.Number).onChange((v: string) => { this.max_iterations = Math.max(10, Math.min(1000, parseInt(v) || 300)); }) }.width('100%').margin({ bottom: 8 })
      Row() { Text('Distance metric:').width(160).fontSize(13); Select(this.metricOpts.map((v, i) => ({ value: v }))).selected(this.metricIdx).onSelect((idx: number) => { this.metricIdx = idx; }) }.width('100%').margin({ bottom: 8 })

      Row() { Text(this.showAdvanced ? '[-] Stress interpretation' : '[+] Stress interpretation').fontSize(11).fontColor('#3498DB').onClick(() => { this.showAdvanced = !this.showAdvanced; }) }.width('100%').margin({ bottom: 8 })
      if (this.showAdvanced) {
        Column() {
          Text('Stress < 0.05: Excellent').fontSize(10).fontColor('#27AE60').margin({ bottom: 2 })
          Text('Stress < 0.10: Good').fontSize(10).fontColor('#3498DB').margin({ bottom: 2 })
          Text('Stress < 0.20: Fair (usable)').fontSize(10).fontColor('#F39C12').margin({ bottom: 2 })
          Text('Stress > 0.20: Poor (questionable)').fontSize(10).fontColor('#E74C3C')
        }.margin({ bottom: 8 })
      }

      Divider().margin({ top: 8, bottom: 12 })
      Row() {
        Button('Cancel').backgroundColor('#95A5A6').fontColor('#FFFFFF').onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button('Run Analysis').type(ButtonType.Capsule).backgroundColor('#3498DB').fontColor('#FFFFFF').enabled(this.errorMsg === '').onClick(() => { this.onConfirm({ n_dimensions: this.n_dimensions, n_restarts: this.n_restarts, max_iterations: this.max_iterations, metric: this.metricOpts[this.metricIdx] }); this.visible = false; })
      }.width('100%').justifyContent(FlexAlign.End)
    }.padding(24).width(480).borderRadius(12)
  }
}