import { DataController } from '../../core/controllers/DataController';
import { StatisticsController } from '../../core/controllers/StatisticsController';
import { StateManager } from '../../core/data/index';
import { parseCSV } from '../../core/parsers/CSVParser';
import { NavigationTree } from '../components/NavigationTree';

@Entry
@Component
struct Index {
  @State currentTab: number = 0;
  @State hasData: boolean = false;
  @State statusText: string = 'PaleoAST-Harmony - Ready';
  @State dataInfo: string = 'No data loaded';
  @State darkMode: boolean = false;
  @State workspaceWidgets: string[] = ['spreadsheet'];
  @State currentWidget: number = 0;

  private stateMgr = StateManager.getInstance();
  private statCtrl = new StatisticsController();

  build() {
    Column() {
      Row() {
        ForEach(['Home','Analysis','Morphometrics','Stratigraphy','Macroevolution'], (tab: string, idx: number) => {
          Text(tab).fontSize(12).fontWeight(this.currentTab === idx ? FontWeight.Bold : FontWeight.Normal)
            .fontColor(this.currentTab === idx ? '#3498DB' : '#2C3E50')
            .padding({ left: 14, right: 14, top: 6, bottom: 6 }).borderRadius(6)
            .backgroundColor(this.currentTab === idx ? '#EBF5FB' : 'transparent')
            .onClick(() => { this.currentTab = idx; })
        })
        Blank()
        Text(this.darkMode ? 'Light' : 'Dark').fontSize(11).fontColor('#7F8C8D').padding(8)
          .onClick(() => { this.darkMode = !this.darkMode; })
      }.width('100%').height(36).padding({ left: 8, right: 8 }).backgroundColor('#F8F9FA')

      Row() {
        NavigationTree().width(220).height('100%')
          .onNavigate((name: string) => { this.handleAnalysis(name); })
        Divider().vertical(true).width(1).color('#E4E7EB')
        Column() {
          if (!this.hasData) {
            Column() {
              Text('PaleoAST').fontSize(48).margin({ bottom: 16 })
              Text('PaleoAST-Harmony').fontSize(24).fontWeight(FontWeight.Bold)
              Text('Load data to begin').fontSize(14).fontColor('#7F8C8D').margin({ top: 8 })
              Button('Open CSV').type(ButtonType.Capsule).backgroundColor('#3498DB')
                .fontColor('#FFFFFF').margin({ top: 20 }).onClick(() => { this.openFile(); })
            }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
          } else {
            Column() {
              Row() {
                ForEach(this.workspaceWidgets, (w: string, idx: number) => {
                  Text(w).fontSize(11).padding(8)
                    .fontColor(this.currentWidget === idx ? '#3498DB' : '#7F8C8D')
                    .onClick(() => { this.currentWidget = idx; })
                })
              }.width('100%').height(28).backgroundColor('#F8F9FA')
              Text(this.dataInfo).fontSize(12).fontFamily('monospace').padding(16)
            }.width('100%').layoutWeight(1)
          }
        }.width('100%').height('100%')
      }.width('100%').layoutWeight(1)

      Row() {
        Text(this.statusText).fontSize(11).fontColor('#7F8C8D').layoutWeight(1)
        Text(this.dataInfo).fontSize(11).fontColor('#BDC3C7')
      }.width('100%').height(28).padding({ left: 12, right: 12 }).backgroundColor('#F8F9FA')
        .border({ width: { top: 1 }, color: '#E4E7EB' })
    }.width('100%').height('100%').backgroundColor(this.darkMode ? '#1a1a2e' : '#FFFFFF')
  }

  private openFile(): void {
    const csv = 'Sample,Var1,Var2,Var3,Var4
A,5.1,3.5,1.4,0.2
B,4.9,3.0,1.4,0.2
C,4.7,3.2,1.3,0.2
D,4.6,3.1,1.5,0.2';
    try {
      const dm = parseCSV(csv);
      this.stateMgr.setData(dm);
      this.hasData = true;
      this.dataInfo = dm.nSamples + ' x ' + dm.nVariables;
      this.statusText = 'Loaded: ' + this.dataInfo;
    } catch (e) { this.statusText = 'Error: ' + e; }
  }

  private handleAnalysis(name: string): void {
    if (!this.hasData) { this.statusText = 'Please load data first'; return; }
    this.statusText = 'Running: ' + name + '...';
    try {
      const data = this.stateMgr.dataMatrix!.data;
      let result: unknown;
      switch (name) {
        case 'PCA': result = this.statCtrl.runPCA(3); break;
        case 'PCoA': result = this.statCtrl.runPCoA(); break;
        case 'NMDS': result = this.statCtrl.runNMDS(); break;
        case 'Summary': result = this.statCtrl.runSummary(); break;
        case 'CONISS': result = this.statCtrl.runCONISS(4); break;
        case 'Markov': result = this.statCtrl.runMarkov(); break;
        case 'Spectral': result = this.statCtrl.runSpectral(); break;
        case 'Directional': result = this.statCtrl.runDirectional(); break;
        case 'Wavelet': result = this.statCtrl.runWavelet(); break;
        case 'GPA': result = this.statCtrl.runGPA(); break;
        case 'EFA': result = this.statCtrl.runEFA(); break;
        case 'NullModel': result = this.statCtrl.runNullModel(); break;
        case 'BetaDiv': result = this.statCtrl.runBetaDiv(); break;
        default: this.statusText = name + ': not implemented'; return;
      }
      this.statusText = name + ' completed';
      if (!this.workspaceWidgets.includes(name)) this.workspaceWidgets.push(name);
      this.currentWidget = this.workspaceWidgets.length - 1;
    } catch (e) { this.statusText = name + ' error: ' + String(e).substring(0, 100); }
  }
}
