/**
 * ConsoleView — Diagnostic console panel
 * Replaces inline @Builder ConsolePanel in Index.ets
 */
import { DiagnosticConsole } from './DiagnosticConsole';
import { token } from '../theme/tokens';

@Component
export struct ConsoleView {
  @Link showConsole: boolean;
  @Link darkMode: boolean;

  build() {
    Column() {
      Row() {
        Text('Diagnostic Console')
          .fontSize(12)
          .fontWeight(FontWeight.Bold);

        Blank();

        Text('Close')
          .fontSize(11)
          .fontColor($r('app.color.text_secondary'))
          .onClick(() => { this.showConsole = false; });
      }
      .width('100%')
      .height(28)
      .padding({ left: 12, right: 12 })
      .backgroundColor($r('app.color.bg_secondary'));

      DiagnosticConsole()
        .layoutWeight(1);
    }
    .height(180)
    .backgroundColor($r('app.color.bg_elevated'))
    .border({ width: { top: 1 }, color: token('border_light', this.darkMode) })
    .transition(TransitionEffect.OPACITY.animation({ duration: 300 }));
  }
}
