/**
 * ConsoleView — Diagnostic console panel
 * Replaces inline @Builder ConsolePanel in Index.ets
 */
import { DiagnosticConsole } from './DiagnosticConsole';

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
          .fontColor('#7F8C8D')
          .onClick(() => { this.showConsole = false; });
      }
      .width('100%')
      .height(28)
      .padding({ left: 12, right: 12 })
      .backgroundColor(this.darkMode ? '#16213e' : '#F8F9FA');

      DiagnosticConsole()
        .layoutWeight(1);
    }
    .height(180)
    .backgroundColor(this.darkMode ? '#0f3460' : '#FAFBFC')
    .border({ width: { top: 1 }, color: '#E4E7EB' })
    .transition(TransitionEffect.OPACITY.animation({ duration: 300 }));
  }
}
