/**
 * CCA Configuration Dialog
 * Canonical Correspondence Analysis (or Redundancy Analysis).
 * (ArkTS structs cannot extend; BaseAnalysisDialog is only a structural template.)
 *
 * onConfirm payload:
 *   n_components   number of constrained axes
 *   method         'cca' | 'rda'
 *   n_env_columns  how many TRAILING table columns form the constraining
 *                  (environment) block; the leading columns are the response
 *                  block. 1 by default.
 */

@Component
export struct CCADialog {
  @Link @Watch('onVisibleChange') visible: boolean;
  @State n_components: number = 3;
  @State n_env_columns: number = 1;
  @State methodIdx: number = 0;
  @State componentError: string = '';
  @State showTips: boolean = false;
  private methodOpts: string[] = ["cca", "rda"];
  onConfirm: (params: Record<string, Object>) => void = () => {};
  onCancel: () => void = () => {};

  onVisibleChange() {
    if (this.visible) {
      this.n_components = 3;
      this.n_env_columns = 1;
      this.methodIdx = 0;
      this.componentError = '';
      this.showTips = false;
    }
  }

  aboutToUpdate() {
    if (this.n_components < 1) {
      this.componentError = 'n_components must be >= 1';
    } else if (this.n_env_columns < 1) {
      this.componentError = 'env columns must be >= 1 (at least one constraining column)';
    } else {
      this.componentError = '';
    }
  }

  @Builder
  contentBuilder() {
    Row() {
      Text('Components:').width(140).fontSize(13)
      TextInput({ text: String(this.n_components) }).width(100).type(InputType.Number)
        .onChange((v: string) => {
          this.n_components = parseInt(v) || 3;
        })
    }.width('100%').margin({ bottom: 8 })

    Row() {
      Text('Env columns (from end):').width(140).fontSize(13)
      TextInput({ text: String(this.n_env_columns) }).width(100).type(InputType.Number)
        .onChange((v: string) => {
          this.n_env_columns = Math.max(1, parseInt(v) || 1);
        })
    }.width('100%').margin({ bottom: 8 })

    if (this.componentError) {
      Text(this.componentError).fontSize(10).fontColor('#E74C3C').margin({ bottom: 4 })
    }

    Row() {
      Text('Method:').width(140).fontSize(13)
      Select(this.methodOpts.map((v, i) => ({ value: v })))
        .selected(this.methodIdx)
        .onSelect((idx: number) => { this.methodIdx = idx; })
    }.width('100%').margin({ bottom: 8 })

    Row() {
      Text('[+] Tips').fontSize(11).fontColor('#3498DB')
        .onClick(() => { this.showTips = !this.showTips; })
    }.width('100%').margin({ bottom: 8 })

    if (this.showTips) {
      Column() {
        Text('CCA: unimodal').fontSize(10).fontColor('#7F8C8D').margin({ bottom: 2 })
        Text('RDA: linear').fontSize(10).fontColor('#7F8C8D').margin({ bottom: 2 })
      }.margin({ bottom: 8 })
    }
  }

  build() {
    Column() {
      Text('CCA').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })

      this.contentBuilder()

      Divider().margin({ top: 8, bottom: 12 })

      Row() {
        Button('Cancel').backgroundColor('#95A5A6').fontColor('#FFFFFF')
          .onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button('Run Analysis').type(ButtonType.Capsule).backgroundColor('#3498DB').fontColor('#FFFFFF')
          .enabled(this.componentError === '')
          .onClick(() => {
            this.onConfirm({
              'n_components': this.n_components,
              'method': this.methodOpts[this.methodIdx],
              'n_env_columns': this.n_env_columns
            });
            this.visible = false;
          })
      }.width('100%').justifyContent(FlexAlign.End)
    }.padding(24).width('92%').constraintSize({ maxWidth: 480 }).borderRadius(12)
  }
}
