/**
 * PCA Configuration Dialog
 */
@Component
export struct PCADialog {
  @Link visible: boolean;
  @State nComponents: number = 3;
  @State method: string = 'covariance';
  onConfirm: (params: Record<string, Object>) => void = () => {};

  build() {
    Column() {
      Text('Principal Component Analysis').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })

      Row() {
        Text('Components:').width(120)
        TextInput({ text: `${this.nComponents}` }).width(100).onChange(v => { this.nComponents = parseInt(v) || 3; })
      }.width('100%').margin({ bottom: 8 })

      Row() {
        Text('Method:').width(120)
        Select([
          { value: 'Covariance' }, { value: 'Correlation' }
        ]).selected(this.method === 'covariance' ? 0 : 1).onSelect((idx: number) => {
          this.method = idx === 0 ? 'covariance' : 'correlation';
        })
      }.width('100%').margin({ bottom: 16 })

      Row() {
        Button('Cancel').onClick(() => { this.visible = false; }).margin({ right: 16 })
        Button('Run').type(ButtonType.Capsule).backgroundColor('#3498DB').onClick(() => {
          this.onConfirm({ nComponents: this.nComponents, method: this.method });
          this.visible = false;
        })
      }.width('100%').justifyContent(FlexAlign.End)
    }.padding(24).width(400)
  }
}
