import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window, display } from '@kit.ArkUI';
import { Breakpoints } from '../config/Breakpoint';

export default class EntryAbility extends UIAbility {
  private windowSizeHandler?: (size: window.Size) => void;
  private mainWindow?: window.Window;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, 'PaleoAST', 'Ability onCreate');
  }

  onDestroy(): void {
    hilog.info(0x0000, 'PaleoAST', 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    hilog.info(0x0000, 'PaleoAST', 'Ability onWindowStageCreate');
    windowStage.loadContent('pages/Splash', (err) => {
      if (err.code) {
        hilog.error(0x0000, 'PaleoAST', 'Failed to load content: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(0x0000, 'PaleoAST', 'Content loaded successfully');
    });

    // ─── Foldable / tri-fold adaptation ─────────────────────────────
    // Track window size so the UI can re-flow (sm ↔ md ↔ lg ↔ xl) while the
    // user folds and unfolds. The listener receives px; Breakpoints converts
    // to vp using the current display density and publishes to AppStorage.
    windowStage.getMainWindow((err, win) => {
      if (err.code) {
        hilog.error(0x0000, 'PaleoAST', 'getMainWindow failed: %{public}s', JSON.stringify(err));
        return;
      }
      this.mainWindow = win;
      try {
        const props = win.getWindowProperties();
        Breakpoints.updateWindowWidth(props.windowRect.width, this.currentDensity());
        this.windowSizeHandler = (size: window.Size) => {
          Breakpoints.updateWindowWidth(size.width, this.currentDensity());
        };
        win.on('windowSizeChange', this.windowSizeHandler);
      } catch (e) {
        hilog.error(0x0000, 'PaleoAST', 'windowSizeChange registration failed: %{public}s', String(e));
      }
    });
  }

  private currentDensity(): number {
    try {
      return display.getDefaultDisplaySync().densityPixels;
    } catch (e) {
      return 1;
    }
  }

  onWindowStageDestroy(): void {
    if (this.mainWindow && this.windowSizeHandler) {
      try {
        this.mainWindow.off('windowSizeChange', this.windowSizeHandler);
      } catch (e) {
        /* window already destroyed */
      }
    }
    hilog.info(0x0000, 'PaleoAST', 'Ability onWindowStageDestroy');
  }

  /**
   * Folding between screens can change the display density (different panels
   * have different DPI). Re-derive the breakpoint from the stored px width.
   */
  onConfigurationUpdate(): void {
    const widthPx = AppStorage.get<number>(Breakpoints.KEY_WINDOW_WIDTH_PX) ?? 0;
    if (widthPx > 0) {
      Breakpoints.updateWindowWidth(widthPx, this.currentDensity());
    }
    hilog.info(0x0000, 'PaleoAST', 'Configuration updated');
  }

  onForeground(): void {
    // Window may have been resized while backgrounded (fold/unfold, free-window
    // drag on tablet) — refresh the breakpoint once.
    if (this.mainWindow) {
      try {
        const props = this.mainWindow.getWindowProperties();
        Breakpoints.updateWindowWidth(props.windowRect.width, this.currentDensity());
      } catch (e) {
        /* window unavailable */
      }
    }
    hilog.info(0x0000, 'PaleoAST', 'Ability onForeground');
  }

  onBackground(): void {
    hilog.info(0x0000, 'PaleoAST', 'Ability onBackground');
  }
}
