import { DialogManager } from './DialogManager';
import { token } from '../theme/tokens';
/**
 * WelcomeView — Welcome screen when no data is loaded
 * Replaces inline @Builder WelcomeView in Index.ets
 */
@Component
export struct WelcomeView {
  @Link darkMode: boolean;

  build() {
    Column() {
      Stack() {
        Column() {
          Text('PaleoAST')
            .fontSize(48)
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.primary'))
            .margin({ bottom: 8 });

          Text('PaleoAST-Harmony')
            .fontSize(20)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.text_primary'));

          Text('Paleontological Advanced Statistical Toolkit')
            .fontSize(12)
            .fontColor($r('app.color.text_secondary'))
            .margin({ top: 4, bottom: 24 });

          Button('打开 CSV 文件')
            .type(ButtonType.Capsule)
            .backgroundColor($r('app.color.primary'))
            .fontColor($r('app.color.text_on_accent'))
            .height(36)
            .fontSize(13)
            .onClick(() => { DialogManager.open('Import'); });
        }
      }
      .backgroundColor($r('app.color.start_window_background'))
      .borderRadius(12)
      .padding(16)
      .shadow({ radius: 8, color: token('shadow_soft', this.darkMode), width: 1, offsetY: 2 })
      .width('60%');
    }
    .width('100%')
    .layoutWeight(1)
    .justifyContent(FlexAlign.Center);
  }
}
