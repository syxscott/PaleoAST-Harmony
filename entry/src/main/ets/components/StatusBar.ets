/**
 * StatusBar — Bottom status bar
 * Replaces inline @Builder StatusBar in Index.ets
 */
@Component
export struct StatusBar {
  @Link statusText: string;
  @Link hasData: boolean;
  @Link dataInfo: string;
  @Link darkMode: boolean;

  build() {
    Row() {
      Text(this.statusText)
        .fontSize(11)
        .fontColor('#7F8C8D')
        .layoutWeight(1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis });

      if (this.hasData) {
        Text(this.dataInfo)
          .fontSize(11)
          .fontColor('#BDC3C7');
      }
    }
    .width('100%')
    .height(28)
    .padding({ left: 12, right: 12 })
    .backgroundColor(this.darkMode ? '#16213e' : '#F8F9FA')
    .border({ width: { top: 1 }, color: '#E4E7EB' });
  }
}
