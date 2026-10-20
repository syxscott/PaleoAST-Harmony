import { common } from '@kit.AbilityKit';
import { applyColorMode, DARK_MODE_KEY } from '../theme/ThemeController';
import { token } from '../theme/tokens';
/**
 * RibbonBar — Top navigation toolbar
 * Replaces inline @Builder RibbonBar in Index.ets
 *
 * Foldable / tri-fold adaptation:
 *  - Small screens (collapsed tri-fold) show a hamburger button that opens
 *    the sidebar drawer, and the tab strip becomes horizontally scrollable
 *    instead of overflowing.
 *  - Large screens keep the one-row layout with a flexible spacer.
 *  - Only attribute-level state changes on breakpoint switches; no component
 *    remount, so fold transitions stay smooth.
 */
@Component
export struct RibbonBar {
  @Link currentTab: number;
  @Link darkMode: boolean;
  @Link canUndo: boolean;
  @Link canRedo: boolean;
  @Link showConsole: boolean;
  /** Collapsed tri-fold state (from AppStorage 'breakpoint' via Index). */
  @Prop isSmallScreen: boolean = false;

  onToggleSidebar: () => void = () => {};
  onUndo: () => void = () => {};
  onRedo: () => void = () => {};

  private tabs: string[] = ['Home', 'Analysis', 'Morphometrics', 'Stratigraphy', 'Macroevolution'];

  build() {
    Row() {
      // 小屏（折叠态）：汉堡按钮打开导航抽屉
      if (this.isSmallScreen) {
        Text('☰')
          .fontSize(18)
          .fontColor($r('app.color.text_primary'))
          .padding({ left: 10, right: 10, top: 8, bottom: 8 })
          .onClick(() => { this.onToggleSidebar(); });
      }

      // 标签条：小屏可横向滚动防溢出（大屏内容装得下，滚动不生效）
      Scroll() {
        Row() {
          ForEach(this.tabs, (tab: string, idx: number) => {
            Text(this.isSmallScreen ? tab.substring(0, 4) : tab)
              .fontSize(this.isSmallScreen ? 12 : 13)
              .fontWeight(this.currentTab === idx ? FontWeight.Bold : FontWeight.Medium)
              .fontColor(this.currentTab === idx ? token('primary', this.darkMode) : (token('text_primary', this.darkMode)))
              .padding({ left: this.isSmallScreen ? 10 : 16, right: this.isSmallScreen ? 10 : 16, top: 8, bottom: 8 })
              .borderRadius(8)
              .backgroundColor(this.currentTab === idx ? (token('bg_tint', this.darkMode)) : 'transparent')
              .animation({ duration: 200, curve: Curve.EaseInOut })
              .onClick(() => {
                animateTo({ duration: 200, curve: Curve.EaseInOut }, () => {
                  this.currentTab = idx;
                });
              });
          });
        }
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .layoutWeight(1)
      .align(Alignment.Start)

      // 右侧固定操作区
      Text('Undo')
        .fontSize(11)
        .fontColor(this.canUndo ? $r('app.color.primary') : $r('app.color.text_disabled'))
        .padding(8)
        .onClick(() => { this.onUndo(); });

      Text('Redo')
        .fontSize(11)
        .fontColor(this.canRedo ? $r('app.color.primary') : $r('app.color.text_disabled'))
        .padding(8)
        .onClick(() => { this.onRedo(); });

      // 小屏收纳 Console 文字按钮，保留最必要的控件
      if (!this.isSmallScreen) {
        Text('Console')
          .fontSize(11)
          .fontColor($r('app.color.text_secondary'))
          .padding(8)
          .onClick(() => {
            animateTo({ duration: 300, curve: Curve.EaseOut }, () => {
              this.showConsole = !this.showConsole;
            });
          });
      }

      Toggle({ type: ToggleType.Switch, isOn: this.darkMode })
        .onChange((isOn: boolean) => {
          this.darkMode = isOn;
          AppStorage.setOrCreate(DARK_MODE_KEY, isOn);
          // The colour resources follow the platform's colour mode, so the
          // switch has to tell the platform as well — otherwise every
          // `$r('app.color.x')` in the application keeps the light value.
          const ctx = this.getUIContext().getHostContext() as common.UIAbilityContext;
          applyColorMode(ctx, isOn);
        })
        .width(40)
        .height(24);
    }
    .width('100%')
    .height(44)
    .padding({ left: this.isSmallScreen ? 4 : 12, right: this.isSmallScreen ? 4 : 12 })
    .backgroundColor($r('app.color.bg_secondary'))
    .border({ width: { bottom: 1 }, color: token('border_light', this.darkMode) });
  }
}
