import router from '@ohos.router';

@Entry
@Component
struct Splash {
  @State progress: number = 0;
  private timerId: number = -1;

  aboutToAppear(): void {
    // Animate progress to 100, then enter the main page
    this.timerId = setInterval(() => {
      this.progress += 5;
      if (this.progress >= 100) {
        if (this.timerId >= 0) {
          clearInterval(this.timerId);
          this.timerId = -1;
        }
        router.pushUrl({ url: 'pages/Index' }).catch((err: Error) => {
          console.error('Splash: navigation to Index failed: ' + err.message);
        });
      }
    }, 100);
  }

  aboutToDisappear(): void {
    if (this.timerId >= 0) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
  }

  build() {
    Column() {
      Text("PaleoAST").fontSize(36).fontWeight(FontWeight.Bold).fontColor("#3498DB").margin({bottom:8})
      LoadingProgress().width(56).height(56).color("#3498DB").margin({bottom:16})
      Progress({value:this.progress, total:100, type:ProgressType.Linear}).width("60%").color("#3498DB")
      Text("v1.0.0 HarmonyOS").fontSize(9).fontColor("#BDC3C7").margin({top:16})
    }.width("100%").height("100%").justifyContent(FlexAlign.Center)
  }
}
