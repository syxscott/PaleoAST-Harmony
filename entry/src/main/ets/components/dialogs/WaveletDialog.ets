/**
 * Wavelet Configuration Dialog
 * Time-frequency analysis for paleo time series.
 * (ArkTS structs cannot extend; BaseAnalysisDialog is only a structural template.)
 */

interface WaveletParams {
  min_scale: number;
  max_scale: number;
}

@Component
export struct WaveletDialog {
  @Link @Watch('onVisibleChange') visible: boolean;
  @State min_scale: number = 2;
  @State max_scale: number = 50;
  @State scaleError: string = '';
  @State showTips: boolean = false;
  onConfirm: (params: Record<string, Object>) => void = () => {};
  onCancel: () => void = () => {};

  onVisibleChange() {
    if (this.visible) {
      this.min_scale = 2;
      this.max_scale = 50;
      this.scaleError = '';
      this.showTips = false;
    }
  }

  aboutToUpdate() {
    if (this.min_scale <= 0) {
      this.scaleError = 'min_scale must be > 0';
    } else if (this.max_scale < 1) {
      this.scaleError = 'max_scale must be >= 1';
    } else if (this.min_scale >= this.max_scale) {
      this.scaleError = 'min_scale must be < max_scale';
    } else {
      this.scaleError = '';
    }
  }

  @Builder
  contentBuilder() {
    Row() {
      Text('Min:').width(140).fontSize(13)
      TextInput({ text: String(this.min_scale) }).width(100).type(InputType.Number)
        .onChange((v: string) => { this.min_scale = parseInt(v) || 2; })
    }.width('100%').margin({ bottom: 8 })

    Row() {
      Text('Max:').width(140).fontSize(13)
      TextInput({ text: String(this.max_scale) }).width(100).type(InputType.Number)
        .onChange((v: string) => { this.max_scale = parseInt(v) || 50; })
    }.width('100%').margin({ bottom: 8 })

    if (this.scaleError) {
      Text(this.scaleError).fontSize(10).fontColor($r('app.color.danger')).margin({ bottom: 4 })
    }

    Row() {
      Text('[+] Tips').fontSize(11).fontColor($r('app.color.primary'))
        .onClick(() => { this.showTips = !this.showTips; })
    }.width('100%').margin({ bottom: 8 })

    if (this.showTips) {
      Column() {
        Text('Higher scales: longer periods').fontSize(10).fontColor($r('app.color.text_secondary')).margin({ bottom: 2 })
      }.margin({ bottom: 8 })
    }
  }

  build() {
    Column() {
      Text('Wavelet').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })

      this.contentBuilder()

      Divider().margin({ top: 8, bottom: 12 })

      Row() {
        Button('Cancel').backgroundColor($r('app.color.bg_muted')).fontColor($r('app.color.text_on_accent'))
          .onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button('Run Analysis').type(ButtonType.Capsule).backgroundColor($r('app.color.primary')).fontColor($r('app.color.text_on_accent'))
          .enabled(this.scaleError === '')
          .onClick(() => {
            this.onConfirm({ 'min_scale': this.min_scale, 'max_scale': this.max_scale });
            this.visible = false;
          })
      }.width('100%').justifyContent(FlexAlign.End)
    }.padding(24).width('92%').constraintSize({ maxWidth: 480 }).borderRadius(12)
  }
}
