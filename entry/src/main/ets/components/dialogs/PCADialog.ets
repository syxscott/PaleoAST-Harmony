/**
 * PCA Configuration Dialog
 * Principal Component Analysis via SVD decomposition.
 */
@Component
export struct PCADialog {
  @Link visible: boolean;
  @State nComponents: number = 3;
  @State methodIdx: number = 0;
  @State errorMsg: string = '';
  @State showAdvanced: boolean = false;
  methodOpts: string[] = ['covariance', 'correlation'];
  methodDesc: string[] = [
    'Covariance: preserves original scale (good when units are same)',
    'Correlation: standardizes to unit variance (good for mixed units)',
  ];
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text('PCA — Principal Component Analysis').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 8 })
      Text('Finds orthogonal axes of maximum variance via SVD.').fontSize(11).fontColor('#7F8C8D').margin({ bottom: 16 })

      Row() {
        Text('Number of components:').width(160).fontSize(13)
        TextInput({ text: String(this.nComponents) }).width(80).type(InputType.Number)
          .onChange((v: string) => {
            const n = parseInt(v) || 3;
            if (n < 1) { this.errorMsg = 'Must be >= 1'; }
            else if (n > 50) { this.errorMsg = 'Maximum 50'; }
            else { this.nComponents = n; this.errorMsg = ''; }
          })
      }.width('100%').margin({ bottom: 4 })

      if (this.errorMsg) { Text(this.errorMsg).fontSize(10).fontColor('#E74C3C').margin({ bottom: 8 }) }

      Row() {
        Text('Method:').width(160).fontSize(13)
        Select(this.methodOpts.map((v, i) => ({ value: v })))
          .selected(this.methodIdx)
          .onSelect((idx: number) => { this.methodIdx = idx; })
      }.width('100%').margin({ bottom: 4 })

      Text(this.methodDesc[this.methodIdx]).fontSize(10).fontColor('#95A5A6').margin({ bottom: 8 })

      Row() {
        Text(this.showAdvanced ? '[-] Tips' : '[+] Tips').fontSize(11).fontColor('#3498DB')
          .onClick(() => { this.showAdvanced = !this.showAdvanced; })
      }.width('100%').margin({ bottom: 8 })

      if (this.showAdvanced) {
        Column() {
          Text('Use correlation PCA when variables have different units.').fontSize(10).fontColor('#7F8C8D').margin({ bottom: 2 })
          Text('Scree plot helps decide how many components to retain.').fontSize(10).fontColor('#7F8C8D').margin({ bottom: 2 })
          Text('Kaiser criterion: retain components with eigenvalue > 1.').fontSize(10).fontColor('#7F8C8D')
        }.margin({ bottom: 8 })
      }

      Divider().margin({ top: 8, bottom: 12 })

      Row() {
        Button('Cancel').backgroundColor('#95A5A6').fontColor('#FFFFFF')
          .onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button('Run Analysis').type(ButtonType.Capsule).backgroundColor('#3498DB').fontColor('#FFFFFF')
          .enabled(this.errorMsg === '')
          .onClick(() => {
            this.onConfirm({ nComponents: this.nComponents, method: this.methodOpts[this.methodIdx] });
            this.visible = false;
          })
      }.width('100%').justifyContent(FlexAlign.End)
    }.padding(24).width(480).borderRadius(12)
  }
}
