import { token } from '../theme/tokens';
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
        .fontColor($r('app.color.text_secondary'))
        .layoutWeight(1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis });

      if (this.hasData) {
        Text(this.dataInfo)
          .fontSize(11)
          .fontColor($r('app.color.text_disabled'));
      }
    }
    .width('100%')
    .height(28)
    .padding({ left: 12, right: 12 })
    .backgroundColor($r('app.color.bg_secondary'))
    .border({ width: { top: 1 }, color: token('border_light', this.darkMode) });
  }
}
