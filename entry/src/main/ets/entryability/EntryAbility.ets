import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window, display } from '@kit.ArkUI';
import { Breakpoints } from '../config/Breakpoint';
import Logger from '../utils/Logger';
import { PreferenceManager } from '../utils/PreferenceManager';
import { HistoryRepository } from '../database/HistoryRepository';

export default class EntryAbility extends UIAbility {
  private windowSizeHandler?: (size: window.Size) => void;
  private mainWindow?: window.Window;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    Logger.info('Ability onCreate');

    // Settings first: everything else reads its defaults from AppStorage.
    PreferenceManager.init(this.context);
    PreferenceManager.loadAllToAppStorage();

    // The history store opens asynchronously; an analysis that runs before it is
    // ready simply skips persistence (HistoryRepository.isReady() guards it).
    HistoryRepository.init(this.context)
      .then(() => { Logger.info('History store ready'); })
      .catch((err: Error) => { Logger.error('History store unavailable: ' + err.message); });
  }

  onDestroy(): void {
    Logger.info('Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    Logger.info('Ability onWindowStageCreate');
    windowStage.loadContent('pages/Splash', (err) => {
      if (err.code) {
        Logger.error('Failed to load content: ' + JSON.stringify(err));
        return;
      }
      Logger.info('Content loaded successfully');
    });

    // ─── Foldable / tri-fold adaptation ─────────────────────────────
    // Track window size so the UI can re-flow (sm ↔ md ↔ lg ↔ xl) while the
    // user folds and unfolds. The listener receives px; Breakpoints converts
    // to vp using the current display density and publishes to AppStorage.
    windowStage.getMainWindow((err, win) => {
      if (err.code) {
        Logger.error('getMainWindow failed: ' + JSON.stringify(err));
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
        Logger.error('windowSizeChange registration failed: ' + String(e));
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
    Logger.info('Ability onWindowStageDestroy');
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
    Logger.info('Configuration updated');
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
    Logger.info('Ability onForeground');
  }

  onBackground(): void {
    Logger.info('Ability onBackground');
  }
}
