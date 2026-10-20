/**
 * Export dialog.
 *
 * The format list previously offered only CSV / TSV / Script, so the whole
 * `core/reporting` package (~1250 lines of Markdown / HTML / LaTeX report
 * generation) was unreachable from the app. The LaTeX path in particular is
 * what a palaeontologist needs for a manuscript table, so it is now offered
 * here rather than sitting unwired.
 */
@Component
export struct ExportDialog {
  @Link @Watch('onVisibleChange') visible: boolean;
  @State formatIdx: number = 0;
  formatOpts: string[] = ['CSV', 'TSV', 'Script', 'Report (Markdown)', 'Report (HTML)', 'Report (LaTeX)'];
  @State includeLabels: boolean = true;
  @State showTips: boolean = false;
  onConfirm: (params: Record<string, Object>) => void = () => {};

  /**
   * Reset every parameter when the dialog is reopened.
   *
   * ArkUI keeps @State values across a visibility toggle, so before this the
   * numbers typed in an earlier session silently reappeared the next time the
   * dialog was opened — and a user who forgets they changed something reads the
   * stale value as the default. For a research tool that means silently wrong
   * results, so the state is restored to its declared defaults on every open.
   */
  onVisibleChange(): void {
    if (!this.visible) return;
    this.formatIdx = 0;
    this.includeLabels = true;
    this.showTips = false;
  }

  build() {
    Column() {
      Text('Export Data').fontSize(18).fontWeight(FontWeight.Bold).margin({ bottom: 16 })
      Row() { Text('Format:').width(80).fontSize(13); Select(this.formatOpts.map((v,i) => ({value:v}))).selected(this.formatIdx).onSelect((idx:number) => { this.formatIdx = idx; }) }.width('100%').margin({ bottom: 8 })
      Row() { Checkbox().select(this.includeLabels).onChange((v:boolean) => { this.includeLabels = v; }); Text('Include labels').fontSize(13).margin({ left: 8 }) }.margin({ bottom: 8 })
      Row() { Text('[+] Tips').fontSize(11).fontColor($r('app.color.primary')).onClick(() => { this.showTips = !this.showTips; }) }.width('100%').margin({ bottom: 8 })
      if (this.showTips) {
        Column() {
          Text('Script: reproduces the analyses you ran, from the persisted history.').fontSize(10).fontColor($r('app.color.text_secondary')).margin({ bottom: 2 })
          Text('Report: Markdown / HTML / LaTeX with the data table and a run summary.').fontSize(10).fontColor($r('app.color.text_secondary')).margin({ bottom: 2 })
          Text('LaTeX compiles with pdflatex; booktabs rules are included.').fontSize(10).fontColor($r('app.color.text_secondary'))
        }.margin({ bottom: 8 }).alignItems(HorizontalAlign.Start)
      }
      Divider().margin({ bottom: 12 })
      Row() {
        Button('Cancel').backgroundColor($r('app.color.bg_muted')).fontColor($r('app.color.text_on_accent')).onClick(() => { this.visible = false; }).margin({ right: 12 })
        Button('Export').type(ButtonType.Capsule).backgroundColor($r('app.color.success')).fontColor($r('app.color.text_on_accent')).onClick(() => { this.doRun(); this.visible = false; })
      }.width('100%').justifyContent(FlexAlign.End)
    }.padding(24).width('92%').constraintSize({ maxWidth: 420 }).borderRadius(12)
  }
  doRun(): void { this.onConfirm({ format: this.formatOpts[this.formatIdx], includeLabels: this.includeLabels }); }
}
