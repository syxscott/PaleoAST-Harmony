import router from '@ohos.router';
// Two levels up: pages/ -> ets/ -> main/, so that the path lands on
// entry/src/main/core/. With one level ('../core/...') it pointed at
// entry/src/main/ets/core/, which does not exist -- a compile error.
import { createPaleoastStartupLoader, type StartupProgress } from '../../core/app_infrastructure/StartupLoader';

@Entry
@Component
struct Splash {
  @State progress: number = 0;
  @State statusLabel: string = 'Starting...';
  private loader = createPaleoastStartupLoader();

  aboutToAppear(): void {
    // 真实模块预热（StartupLoader，startup/loader.py 模式）：依赖拓扑排序 +
    // 进度回调。NAPI 加速探测由 loader 自带的 'native' 模块负责，它的 promise
    // 被 await —— 之前这里另加了一个 'native-detect' 模块，重复探测一次而且
    // 丢弃 promise（`void initNative()`），启动失败因此永远报不出来。
    this.loader.load((p: StartupProgress) => {
      this.progress = p.percent;
      this.statusLabel = p.currentModule.length > 0 ? p.currentModule : p.phase;
      if (p.error) this.statusLabel = 'Error: ' + p.error;
    }).then((ok: boolean) => {
      this.progress = 100;
      this.statusLabel = ok ? 'Ready' : 'Started with warnings';
      setTimeout(() => {
        router.pushUrl({ url: 'pages/Index' }).catch((err: Error) => {
          console.error('Splash: navigation to Index failed: ' + err.message);
        });
      }, 150);
    });
  }

  build() {
    Column() {
      Text("PaleoAST").fontSize(36).fontWeight(FontWeight.Bold).fontColor($r('app.color.primary')).margin({bottom:8})
      LoadingProgress().width(56).height(56).color($r('app.color.primary')).margin({bottom:16})
      Progress({value:this.progress, total:100, type:ProgressType.Linear}).width("60%").color($r('app.color.primary'))
      Text(this.statusLabel).fontSize(10).fontColor($r('app.color.text_secondary')).margin({top:8})
      Text("v1.0.0 HarmonyOS").fontSize(9).fontColor($r('app.color.text_disabled')).margin({top:16})
    }.width("100%").height("100%").justifyContent(FlexAlign.Center)
  }
}
