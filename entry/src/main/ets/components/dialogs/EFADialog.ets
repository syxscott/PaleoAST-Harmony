/**
 * EFA Configuration Dialog
 * Elliptic Fourier Analysis of closed contours (Kuhl & Giardina 1982).
 */
@Component
export struct EFADialog {
  @Link visible: boolean;
  @State n_harmonics: number = 10;
  @State n_points: number = 200;
  @State errorMsg: string = '';
  @State showAdvanced: boolean = false;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text('EFA — Elliptic Fourier Analysis').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 8 })
      Text('Decomposes closed contours into harmonic components.').fontSize(11).fontColor('#7F8C8D').margin({ bottom: 16 })

      Row() {
        Text('Number of harmonics:').width(160).fontSize(13)
        TextInput({ text: String(this.n_harmonics) }).width(80).type(InputType.Number)
          .onChange((v: string) => {
            const n = parseInt(v) || 10;
            if (n < 2) { this.errorMsg = 'Need at least 2 harmonics'; }
            else if (n > 50) { this.errorMsg = 'Maximum 50 harmonics'; }
            else { this.n_harmonics = n; this.errorMsg = ''; }
          })
      }.width('100%').margin({ bottom: 4 })

      if (this.errorMsg) { Text(this.errorMsg).fontSize(10).fontColor('#E74C3C').margin({ bottom: 8 }) }

      Row() {
        Text('Resample points:').width(160).fontSize(13)
        TextInput({ text: String(this.n_points) }).width(80).type(InputType.Number)
          .onChange((v: string) => { this.n_points = Math.max(20, Math.min(1000, parseInt(v) || 200)); })
      }.width('100%').margin({ bottom: 8 })

      Row() {
        Text(this.showAdvanced ? '[-] Tips' : '[+] Tips').fontSize(11).fontColor('#3498DB')
          .onClick(() => { this.showAdvanced = !this.showAdvanced; })
      }.width('100%').margin({ bottom: 8 })

      if (this.showAdvanced) {
        Column() {
          Text('Data format: columns are [x1,x2,...,xN,y1,y2,...,yN].').fontSize(10).fontColor('#7F8C8D').margin({ bottom: 2 })
          Text('First row is used as the contour specimen.').fontSize(10).fontColor('#7F8C8D').margin({ bottom: 2 })
          Text('Low harmonics capture overall shape; high harmonics capture detail.').fontSize(10).fontColor('#7F8C8D').margin({ bottom: 2 })
          Text('10 harmonics is sufficient for most shapes.').fontSize(10).fontColor('#7F8C8D')
        }.margin({ bottom: 8 })
      }

      Divider().margin({ top: 8, bottom: 12 })

      Row() {
        Button('Cancel').backgroundColor('#95A5A6').fontColor('#FFFFFF')
          .onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button('Run Analysis').type(ButtonType.Capsule).backgroundColor('#3498DB').fontColor('#FFFFFF')
          .enabled(this.errorMsg === '')
          .onClick(() => {
            this.onConfirm({ n_harmonics: this.n_harmonics, n_points: this.n_points });
            this.visible = false;
          })
      }.width('100%').justifyContent(FlexAlign.End)
    }.padding(24).width(480).borderRadius(12)
  }
}