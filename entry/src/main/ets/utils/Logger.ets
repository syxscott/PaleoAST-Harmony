/**
 * Unified ArkTS logger.
 *
 * Keeps one domain + tag for the whole app so log lines can be filtered as a
 * group, and pairs with the C++ side (entry/src/main/cpp/utils/Logger.h) which
 * uses the same domain and a matching tag.
 *
 * Levels: debug/info respect `isDebug` (flip it to false for store builds);
 * warn/error are always emitted.
 */
import hilog from '@ohos.hilog';

class Logger {
  private domain: number = 0x0000;
  private prefix: string;
  /** Set false for release builds to drop debug/info noise. */
  private isDebug: boolean = true;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  debug(msg: string): void {
    if (this.isDebug) {
      hilog.debug(this.domain, this.prefix, '%{public}s', msg);
    }
  }

  info(msg: string): void {
    if (this.isDebug) {
      hilog.info(this.domain, this.prefix, '%{public}s', msg);
    }
  }

  warn(msg: string): void {
    hilog.warn(this.domain, this.prefix, '%{public}s', msg);
  }

  error(msg: string): void {
    hilog.error(this.domain, this.prefix, '%{public}s', msg);
  }
}

export default new Logger('PaleoAST_ArkTS');
