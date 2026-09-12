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
          .fontColor(this.darkMode ? '#ccc' : '#2C3E50')
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
              .fontColor(this.currentTab === idx ? '#3498DB' : (this.darkMode ? '#ccc' : '#2C3E50'))
              .padding({ left: this.isSmallScreen ? 10 : 16, right: this.isSmallScreen ? 10 : 16, top: 8, bottom: 8 })
              .borderRadius(8)
              .backgroundColor(this.currentTab === idx ? (this.darkMode ? '#2a2a4a' : '#EBF5FB') : 'transparent')
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
        .fontColor(this.canUndo ? '#3498DB' : '#BDC3C7')
        .padding(8)
        .onClick(() => { this.onUndo(); });

      Text('Redo')
        .fontSize(11)
        .fontColor(this.canRedo ? '#3498DB' : '#BDC3C7')
        .padding(8)
        .onClick(() => { this.onRedo(); });

      // 小屏收纳 Console 文字按钮，保留最必要的控件
      if (!this.isSmallScreen) {
        Text('Console')
          .fontSize(11)
          .fontColor('#7F8C8D')
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
          AppStorage.setOrCreate('darkMode', isOn);
        })
        .width(40)
        .height(24);
    }
    .width('100%')
    .height(44)
    .padding({ left: this.isSmallScreen ? 4 : 12, right: this.isSmallScreen ? 4 : 12 })
    .backgroundColor(this.darkMode ? '#16213e' : '#F8F9FA')
    .border({ width: { bottom: 1 }, color: '#E4E7EB' });
  }
}
