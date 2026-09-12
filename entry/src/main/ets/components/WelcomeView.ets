/**
 * WelcomeView — Welcome screen when no data is loaded
 * Replaces inline @Builder WelcomeView in Index.ets
 */
@Component
export struct WelcomeView {
  @Link darkMode: boolean;
  @Link showImportDialog: boolean;

  build() {
    Column() {
      Stack() {
        Column() {
          Text('PaleoAST')
            .fontSize(48)
            .fontWeight(FontWeight.Bold)
            .fontColor('#3498DB')
            .margin({ bottom: 8 });

          Text('PaleoAST-Harmony')
            .fontSize(20)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.darkMode ? '#ccc' : '#2C3E50');

          Text('Paleontological Advanced Statistical Toolkit')
            .fontSize(12)
            .fontColor('#7F8C8D')
            .margin({ top: 4, bottom: 24 });

          Button('打开 CSV 文件')
            .type(ButtonType.Capsule)
            .backgroundColor('#3498DB')
            .fontColor('#FFFFFF')
            .height(36)
            .fontSize(13)
            .onClick(() => { this.showImportDialog = true; });
        }
      }
      .backgroundColor(this.darkMode ? '#1a1a2e' : '#FFFFFF')
      .borderRadius(12)
      .padding(16)
      .shadow({ radius: 8, color: '#00000010', width: 1, offsetY: 2 })
      .width('60%');
    }
    .width('100%')
    .layoutWeight(1)
    .justifyContent(FlexAlign.Center);
  }
}
