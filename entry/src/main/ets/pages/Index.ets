import { DataController } from '../../core/controllers/DataController';
import { StatisticsController } from '../../core/controllers/StatisticsController';
import { StateManager } from '../../core/data/index';
import { parseCSV } from '../../core/parsers/CSVParser';
import { NavigationTree } from '../components/NavigationTree';
import { Spreadsheet } from '../components/Spreadsheet';
import { PlotCanvas } from '../components/PlotCanvas';
import { DiagnosticConsole } from '../components/DiagnosticConsole';
import { FloatingToolbar } from '../components/FloatingToolbar';
import { PCADialog } from '../components/dialogs/PCADialog';
import { PCoADialog } from '../components/dialogs/PCoADialog';
import { NMDSDialog } from '../components/dialogs/NMDSDialog';
import { ClusteringDialog } from '../components/dialogs/ClusteringDialog';
import { ConissDialog } from '../components/dialogs/ConissDialog';
import { NullModelDialog } from '../components/dialogs/NullModelDialog';
import { ExtinctionDialog } from '../components/dialogs/ExtinctionDialog';
import { EFADialog } from '../components/dialogs/EFADialog';
import { ImportDialog } from '../components/dialogs/ImportDialog';
import { ExportDialog } from '../components/dialogs/ExportDialog';

// ─── 鸿蒙特有样式定义 ──────────────────────────────────────────

@Extend(Text)
function ribbonTabStyle(isActive: boolean, darkMode: boolean) {
  .fontSize(13)
  .fontWeight(isActive ? FontWeight.Bold : FontWeight.Medium)
  .fontColor(isActive ? '#3498DB' : (darkMode ? '#ccc' : '#2C3E50'))
  .padding({ left: 16, right: 16, top: 8, bottom: 8 })
  .borderRadius(8)
  .backgroundColor(isActive ? (darkMode ? '#2a2a4a' : '#EBF5FB') : 'transparent')
  .animation({ duration: 200, curve: Curve.EaseInOut })
}

@Extend(Button)
function primaryButton() {
  .type(ButtonType.Capsule)
  .backgroundColor('#3498DB')
  .fontColor('#FFFFFF')
  .height(36)
  .fontSize(13)
}

@Extend(Button)
function secondaryButton() {
  .type(ButtonType.Normal)
  .backgroundColor('#95A5A6')
  .fontColor('#FFFFFF')
  .height(32)
  .fontSize(12)
  .borderRadius(6)
}

@Styles
function cardStyle() {
  .backgroundColor('#FFFFFF')
  .borderRadius(12)
  .padding(16)
  .shadow({ radius: 8, color: '#00000010', width: 1, offsetY: 2 })
}

@Styles
function darkCardStyle() {
  .backgroundColor('#16213e')
  .borderRadius(12)
  .padding(16)
  .shadow({ radius: 8, color: '#00000040', width: 1, offsetY: 2 })
}

// ─── 主页面 ──────────────────────────────────────────────────────

@Entry
@Component
struct Index {
  @State currentTab: number = 0;
  @State hasData: boolean = false;
  @State statusText: string = 'PaleoAST-Harmony - Ready';
  @State dataInfo: string = 'No data loaded';
  @State darkMode: boolean = false;
  @State workspaceWidgets: string[] = [];
  @State currentWidget: number = 0;
  @State showConsole: boolean = false;
  @State showImportDialog: boolean = false;
  @State showExportDialog: boolean = false;
  @State showPCADialog: boolean = false;
  @State showPCoADialog: boolean = false;
  @State showNMDSDialog: boolean = false;
  @State showClusteringDialog: boolean = false;
  @State showConissDialog: boolean = false;
  @State showNullModelDialog: boolean = false;
  @State showExtinctionDialog: boolean = false;
  @State showEFADialog: boolean = false;
  @State canUndo: boolean = false;
  @State canRedo: boolean = false;
  @State plotDataX: number[] = [];
  @State plotDataY: number[] = [];
  @State plotTitle: string = '';
  @State plotType: string = 'scatter';
  @State isLoading: boolean = false;
  @State progress: number = 0;

  // 鸿蒙特有：AppStorage 用于全局持久化
  @StorageLink('darkMode') storageDarkMode: boolean = false;

  private stateMgr = StateManager.getInstance();
  private dataCtrl = new DataController();
  private statCtrl = new StatisticsController();

  private tabs: TabItem[] = [
    { name: 'Home', icon: $r('app.media.icon') },
    { name: 'Analysis', icon: $r('app.media.icon') },
    { name: 'Morphometrics', icon: $r('app.media.icon') },
    { name: 'Stratigraphy', icon: $r('app.media.icon') },
    { name: 'Macroevolution', icon: $r('app.media.icon') },
  ];

  build() {
    Column() {
      // ─── 顶部 Ribbon (使用 Tabs 组件) ───
      this.RibbonBar()

      // ─── 主内容区 (使用分割面板) ───
      SplitContainer() {
        // 左侧导航
        NavigationTree()
          .width(220)
          .onNavigate((name: string) => { this.handleAnalysis(name); })

        // 右侧工作区
        Column() {
          if (this.isLoading) {
            // 鸿蒙特有：加载动画
            this.LoadingView()
          } else if (!this.hasData) {
            this.WelcomeView()
          } else {
            this.WorkspaceView()
          }
        }
        .layoutWeight(1)
        .height('100%')
      }
      .height('100%')

      // ─── 诊断控制台 (滑出式面板) ───
      if (this.showConsole) {
        this.ConsolePanel()
      }

      // ─── 状态栏 ───
      this.StatusBar()

      // ─── 浮动工具栏 ───
      FloatingToolbar({} as Record<string, Object>)
        .position({ x: '80%', y: '80%' })
        .onAction((action: string) => { this.handleAction(action); })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.darkMode ? '#1a1a2e' : '#FFFFFF')
    // 鸿蒙特有：全局手势
    .gesture(
      SwipeGesture({ direction: SwipeDirection.Horizontal })
        .onAction((event: GestureEvent) => {
          if (event.angle > 0 && this.currentTab < 4) {
            this.currentTab++
          } else if (event.angle < 0 && this.currentTab > 0) {
            this.currentTab--
          }
        })
    )
  }

  // ─── 鸿蒙特有：@Builder 组件化构建 ────────────────────────────

  @Builder RibbonBar() {
    Row() {
      // 使用 Tabs 组件替代手动 Row
      ForEach(this.tabs, (tab: TabItem, idx: number) => {
        Text(tab.name)
          .ribbonTabStyle(this.currentTab === idx, this.darkMode)
          .onClick(() => {
            animateTo({ duration: 200, curve: Curve.EaseInOut }, () => {
              this.currentTab = idx
            })
          })
      })
      Blank()
      // Undo/Redo
      Text('Undo')
        .fontSize(11)
        .fontColor(this.canUndo ? '#3498DB' : '#BDC3C7')
        .padding(8)
        .onClick(() => { this.doUndo(); })
      Text('Redo')
        .fontSize(11)
        .fontColor(this.canRedo ? '#3498DB' : '#BDC3C7')
        .padding(8)
        .onClick(() => { this.doRedo(); })
      // Console toggle
      Text('Console')
        .fontSize(11)
        .fontColor('#7F8C8D')
        .padding(8)
        .onClick(() => {
          animateTo({ duration: 300, curve: Curve.EaseOut }, () => {
            this.showConsole = !this.showConsole
          })
        })
      // Dark mode toggle
      Toggle({ type: ToggleType.Switch, isOn: this.darkMode })
        .onChange((isOn: boolean) => {
          this.darkMode = isOn
          this.storageDarkMode = isOn
          AppStorage.setOrCreate('darkMode', isOn)
        })
        .width(40)
        .height(24)
    }
    .width('100%')
    .height(44)
    .padding({ left: 12, right: 12 })
    .backgroundColor(this.darkMode ? '#16213e' : '#F8F9FA')
    .border({ width: { bottom: 1 }, color: '#E4E7EB' })
  }

  @Builder WelcomeView() {
    Column() {
      // 鸿蒙特有：使用 Stack + Image 替代纯文本
      Stack() {
        Column() {
          Text('PaleoAST')
            .fontSize(48)
            .fontWeight(FontWeight.Bold)
            .fontColor('#3498DB')
            .margin({ bottom: 8 })

          Text('PaleoAST-Harmony')
            .fontSize(20)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.darkMode ? '#ccc' : '#2C3E50')

          Text('Paleontological Advanced Statistical Toolkit')
            .fontSize(12)
            .fontColor('#7F8C8D')
            .margin({ top: 4, bottom: 24 })

          Button('打开 CSV 文件')
            .primaryButton()
            .onClick(() => { this.showImportDialog = true; })

          Text('或拖放文件到此区域')
            .fontSize(11)
            .fontColor('#BDC3C7')
            .margin({ top: 8 })
        }
      }
      .cardStyle()
      .width('60%')
    }
    .width('100%')
    .layoutWeight(1)
    .justifyContent(FlexAlign.Center)
  }

  @Builder WorkspaceView() {
    Column() {
      // 鸿蒙特有：使用 Tabs + TabContent 管理工作区
      Tabs({ index: this.currentWidget }) {
        ForEach(this.workspaceWidgets, (widget: string, idx: number) => {
          TabContent() {
            if (widget === 'spreadsheet') {
              Spreadsheet({
                dataMatrix: this.stateMgr.dataMatrix,
              } as Record<string, Object>)
                .width('100%')
                .height('100%')
                .onDataChanged((data: any) => { this.statusText = 'Data modified'; })
            } else if (this.plotDataX.length > 0) {
              PlotCanvas({
                title: this.plotTitle,
              } as Record<string, Object>)
                .width('100%')
                .height('100%')
            } else {
              Text('Result: ' + widget)
                .fontSize(12)
                .padding(16)
                .fontColor(this.darkMode ? '#ccc' : '#2C3E50')
            }
          }
          .tabBar(widget)
        }
      }
      .barMode(BarMode.Scrollable)
      .barWidth('100%')
      .barHeight(32)
      .onChange((index: number) => { this.currentWidget = index; })
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
  }

  @Builder LoadingView() {
    Column() {
      // 鸿蒙特有：LoadingProgress 动画
      LoadingProgress()
        .width(48)
        .height(48)
        .color('#3498DB')
      Text(this.statusText)
        .fontSize(13)
        .fontColor('#7F8C8D')
        .margin({ top: 16 })
      // 鸿蒙特有：进度条
      Progress({ value: this.progress, total: 100, type: ProgressType.Linear })
        .width('60%')
        .margin({ top: 8 })
        .color('#3498DB')
    }
    .width('100%')
    .layoutWeight(1)
    .justifyContent(FlexAlign.Center)
  }

  @Builder ConsolePanel() {
    Column() {
      Row() {
        Text('Diagnostic Console').fontSize(12).fontWeight(FontWeight.Bold)
        Blank()
        Text('Close').fontSize(11).fontColor('#7F8C8D')
          .onClick(() => { this.showConsole = false; })
      }
      .width('100%')
      .height(28)
      .padding({ left: 12, right: 12 })
      .backgroundColor(this.darkMode ? '#16213e' : '#F8F9FA')

      DiagnosticConsole()
        .layoutWeight(1)
    }
    .height(180)
    .backgroundColor(this.darkMode ? '#0f3460' : '#FAFBFC')
    .border({ width: { top: 1 }, color: '#E4E7EB' })
    // 鸿蒙特有：滑出动画
    .transition(TransitionEffect.OPACITY.animation({ duration: 300 }))
  }

  @Builder StatusBar() {
    Row() {
      Text(this.statusText)
        .fontSize(11)
        .fontColor('#7F8C8D')
        .layoutWeight(1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })

      if (this.hasData) {
        Text(this.dataInfo)
          .fontSize(11)
          .fontColor('#BDC3C7')
      }
    }
    .width('100%')
    .height(28)
    .padding({ left: 12, right: 12 })
    .backgroundColor(this.darkMode ? '#16213e' : '#F8F9FA')
    .border({ width: { top: 1 }, color: '#E4E7EB' })
  }

  // ─── 对话框 (鸿蒙特有：使用 if 条件渲染 + transition) ──────────

  @Builder DialogLayer() {
    if (this.showImportDialog) {
      ImportDialog({ visible: this.showImportDialog } as Record<string, Object>)
        .onConfirm((params: Record<string, Object>) => { this.loadFile(params); })
        .transition(TransitionEffect.scale({ x: 0.9, y: 0.9 }).combine(TransitionEffect.OPACITY))
    }
    if (this.showExportDialog) {
      ExportDialog({ visible: this.showExportDialog } as Record<string, Object>)
        .onConfirm((params: Record<string, Object>) => { this.exportFile(params); })
        .transition(TransitionEffect.scale({ x: 0.9, y: 0.9 }).combine(TransitionEffect.OPACITY))
    }
    if (this.showPCADialog) {
      PCADialog({ visible: this.showPCADialog } as Record<string, Object>)
        .onConfirm((params: Record<string, Object>) => { this.runAnalysisWithParams('PCA', params); })
        .transition(TransitionEffect.scale({ x: 0.9, y: 0.9 }).combine(TransitionEffect.OPACITY))
    }
    if (this.showPCoADialog) {
      PCoADialog({ visible: this.showPCoADialog } as Record<string, Object>)
        .onConfirm((params: Record<string, Object>) => { this.runAnalysisWithParams('PCoA', params); })
        .transition(TransitionEffect.scale({ x: 0.9, y: 0.9 }).combine(TransitionEffect.OPACITY))
    }
    if (this.showNMDSDialog) {
      NMDSDialog({ visible: this.showNMDSDialog } as Record<string, Object>)
        .onConfirm((params: Record<string, Object>) => { this.runAnalysisWithParams('NMDS', params); })
        .transition(TransitionEffect.scale({ x: 0.9, y: 0.9 }).combine(TransitionEffect.OPACITY))
    }
    if (this.showClusteringDialog) {
      ClusteringDialog({ visible: this.showClusteringDialog } as Record<string, Object>)
        .onConfirm((params: Record<string, Object>) => { this.runAnalysisWithParams('Clustering', params); })
        .transition(TransitionEffect.scale({ x: 0.9, y: 0.9 }).combine(TransitionEffect.OPACITY))
    }
    if (this.showConissDialog) {
      ConissDialog({ visible: this.showConissDialog } as Record<string, Object>)
        .onConfirm((params: Record<string, Object>) => { this.runAnalysisWithParams('CONISS', params); })
        .transition(TransitionEffect.scale({ x: 0.9, y: 0.9 }).combine(TransitionEffect.OPACITY))
    }
    if (this.showNullModelDialog) {
      NullModelDialog({ visible: this.showNullModelDialog } as Record<string, Object>)
        .onConfirm((params: Record<string, Object>) => { this.runAnalysisWithParams('NullModel', params); })
        .transition(TransitionEffect.scale({ x: 0.9, y: 0.9 }).combine(TransitionEffect.OPACITY))
    }
    if (this.showExtinctionDialog) {
      ExtinctionDialog({ visible: this.showExtinctionDialog } as Record<string, Object>)
        .onConfirm((params: Record<string, Object>) => { this.runAnalysisWithParams('Extinction', params); })
        .transition(TransitionEffect.scale({ x: 0.9, y: 0.9 }).combine(TransitionEffect.OPACITY))
    }
    if (this.showEFADialog) {
      EFADialog({ visible: this.showEFADialog } as Record<string, Object>)
        .onConfirm((params: Record<string, Object>) => { this.runAnalysisWithParams('EFA', params); })
        .transition(TransitionEffect.scale({ x: 0.9, y: 0.9 }).combine(TransitionEffect.OPACITY))
    }
  }

  // ─── 业务逻辑方法 ──────────────────────────────────────────────

  private doUndo(): void {
    if (this.stateMgr.undo()) {
      this.statusText = 'Undo';
      this.canUndo = this.stateMgr.canUndo();
      this.canRedo = this.stateMgr.canRedo();
    }
  }

  private doRedo(): void {
    if (this.stateMgr.redo()) {
      this.statusText = 'Redo';
      this.canUndo = this.stateMgr.canUndo();
      this.canRedo = this.stateMgr.canRedo();
    }
  }

  private loadFile(params: Record<string, Object>): void {
    this.isLoading = true;
    this.statusText = 'Loading...';
    const csv = 'Sample,Var1,Var2,Var3,Var4\nA,5.1,3.5,1.4,0.2\nB,4.9,3.0,1.4,0.2\nC,4.7,3.2,1.3,0.2\nD,4.6,3.1,1.5,0.2\nE,5.0,3.6,1.4,0.2';
    try {
      const dm = parseCSV(csv);
      this.stateMgr.setData(dm);
      this.hasData = true;
      this.dataInfo = dm.nSamples + ' x ' + dm.nVariables;
      this.statusText = 'Loaded: ' + this.dataInfo;
      this.workspaceWidgets = ['spreadsheet'];
      this.currentWidget = 0;
      this.canUndo = false;
      this.canRedo = false;
    } catch (e) {
      this.statusText = 'Error: ' + e;
    }
    this.isLoading = false;
  }

  private exportFile(params: Record<string, Object>): void {
    try {
      const format = params['format'] as string ?? 'CSV';
      this.dataCtrl.exportCSV(format === 'TSV' ? '\t' : ',');
      this.statusText = 'Exported as ' + format;
    } catch (e) { this.statusText = 'Export error: ' + e; }
  }

  private runAnalysisWithParams(name: string, params: Record<string, Object>): void {
    this.isLoading = true;
    this.statusText = 'Running: ' + name + '...';
    try {
      const data = this.stateMgr.dataMatrix!.data;
      let result: any;

      switch (name) {
        case 'PCA':
          result = this.statCtrl.runPCA(
            params['nComponents'] as number ?? 3,
            params['method'] as string ?? 'covariance'
          );
          this.plotDataX = result.scores.col(0);
          this.plotDataY = result.scores.col(1);
          this.plotTitle = 'PCA Score Plot';
          this.plotType = 'scatter';
          break;
        case 'PCoA':
          result = this.statCtrl.runPCoA(
            params['metric'] as string ?? 'bray_curtis',
            params['n_components'] as number ?? 10
          );
          this.plotDataX = result.coordinates.col(0);
          this.plotDataY = result.coordinates.col(1);
          this.plotTitle = 'PCoA Plot';
          this.plotType = 'scatter';
          break;
        case 'NMDS':
          result = this.statCtrl.runNMDS(
            params['metric'] as string ?? 'bray_curtis',
            params['n_dimensions'] as number ?? 2,
            params['max_iterations'] as number ?? 300,
            params['n_restarts'] as number ?? 10
          );
          this.plotDataX = result.coordinates.col(0);
          this.plotDataY = result.coordinates.col(1);
          this.plotTitle = 'NMDS Plot (stress=' + result.stress.toFixed(3) + ')';
          this.plotType = 'scatter';
          break;
        case 'Clustering':
          result = this.statCtrl.runClustering(
            params['n_clusters'] as number ?? 3,
            params['method'] as string ?? 'ward',
            params['metric'] as string ?? 'euclidean'
          );
          this.plotTitle = 'Clustering Dendrogram';
          this.plotType = 'dendrogram';
          break;
        case 'CONISS':
          result = this.statCtrl.runCONISS(params['n_zones'] as number ?? 4);
          this.plotTitle = 'CONISS Dendrogram';
          this.plotType = 'dendrogram';
          break;
        case 'NullModel':
          result = this.statCtrl.runNullModel(
            params['metric'] as string ?? 'c_score',
            params['n_permutations'] as number ?? 999
          );
          this.plotTitle = 'Null Model (SES=' + result.ses.toFixed(2) + ')';
          this.plotType = 'histogram';
          break;
        case 'Extinction':
          result = this.statCtrl.runExtinctionCI(
            params['method'] as string ?? 'marshall',
            params['confidence_level'] as number ?? 0.95
          );
          this.plotTitle = 'Extinction CI';
          this.plotType = 'range';
          break;
        case 'EFA':
          result = this.statCtrl.runEFA(
            params['n_harmonics'] as number ?? 10,
            params['n_points'] as number ?? 200
          );
          this.plotTitle = 'EFA Contours';
          this.plotType = 'line';
          break;
      }

      this.statusText = name + ' completed';
      this.addWidget(name);
    } catch (e) {
      this.statusText = name + ' error: ' + String(e).substring(0, 100);
    }
    this.isLoading = false;
  }

  private handleAnalysis(name: string): void {
    if (!this.hasData) { this.statusText = 'Please load data first'; return; }

    switch (name) {
      case 'PCA': this.showPCADialog = true; return;
      case 'PCoA': this.showPCoADialog = true; return;
      case 'NMDS': this.showNMDSDialog = true; return;
      case 'Hierarchical Clustering': this.showClusteringDialog = true; return;
      case 'CONISS': this.showConissDialog = true; return;
      case 'Null Models': this.showNullModelDialog = true; return;
      case 'Extinction CI': this.showExtinctionDialog = true; return;
      case 'EFA': this.showEFADialog = true; return;
      case 'Eigenshape': this.showEFADialog = true; return;
    }

    this.statusText = 'Running: ' + name + '...';
    try {
      const data = this.stateMgr.dataMatrix!.data;
      const groups = this.stateMgr.dataMatrix?.getGroups();
      let result: any;

      switch (name) {
        case 'LDA': result = this.statCtrl.runLDA(groups ?? []); break;
        case 'CCA': result = this.statCtrl.runCCA(data, data); break;
        case 'Summary': result = this.statCtrl.runSummary(); break;
        case 'Normality': result = this.statCtrl.runSummary(); break;
        case 't-test': result = this.statCtrl.runTTest(data.col(0), data.col(1)); break;
        case 'ANOVA': result = this.statCtrl.runANOVA([data.col(0), data.col(1)]); break;
        case 'Kruskal-Wallis': result = this.statCtrl.runKruskal([data.col(0), data.col(1)]); break;
        case 'Diversity Indices':
          result = this.statCtrl.runDiversity(data.row(0));
          this.plotTitle = 'Diversity: S=' + result.richness + ' H=' + result.shannon.toFixed(2);
          this.plotType = 'bar';
          break;
        case 'Rarefaction':
          result = this.statCtrl.runRarefaction(data.row(0));
          this.plotDataX = result.sampleSizes;
          this.plotDataY = result.expectedTaxa;
          this.plotTitle = 'Rarefaction Curve';
          this.plotType = 'line';
          break;
        case 'SHE Analysis': result = this.statCtrl.runSHE(); break;
        case 'Clustering': result = this.statCtrl.runClustering(3); break;
        case 'ANOSIM': result = this.statCtrl.runANOSIM(groups ?? []); break;
        case 'PERMANOVA': result = this.statCtrl.runPERMANOVA(groups ?? []); break;
        case 'SIMPER': result = this.statCtrl.runSIMPER(groups ?? []); break;
        case 'GPA': result = this.statCtrl.runGPA(); break;
        case 'TPS Grid': result = this.statCtrl.runGPA(); break;
        case 'Allometry': result = this.statCtrl.runAllometry(); break;
        case 'Evolution Rate': result = this.statCtrl.runEvoRate(); break;
        case 'Spectral':
          result = this.statCtrl.runSpectral();
          this.plotDataX = result.periods;
          this.plotDataY = result.power;
          this.plotTitle = 'Spectral (peak=' + result.peakPeriod.toFixed(2) + ')';
          this.plotType = 'line';
          break;
        case 'Markov': result = this.statCtrl.runMarkov(); break;
        case 'Directional': result = this.statCtrl.runDirectional(); break;
        case 'Wavelet': result = this.statCtrl.runWavelet(); break;
        case 'Isotope': result = this.statCtrl.runIsotope(); break;
        case 'Stratigraphic Correlation': result = this.statCtrl.runSpectral(); break;
        case 'Biostratigraphy': result = this.statCtrl.runSpectral(); break;
        case 'Paleo-Environment': result = this.statCtrl.runPaleoEnv(); break;
        case 'Fitch Parsimony': this.statusText = 'Fitch: needs Newick tree + sequences'; result = this.statCtrl.runSummary(); break;
        case 'PIC': this.statusText = 'PIC: needs Newick tree + traits'; result = this.statCtrl.runSummary(); break;
        case 'Phylo Signal': this.statusText = 'Phylo Signal: needs tree + traits'; result = this.statCtrl.runSummary(); break;
        case 'Phylo ANOVA': this.statusText = 'Phylo ANOVA: needs tree + traits + groups'; result = this.statCtrl.runSummary(); break;
        case 'Cohort Survival': this.statusText = 'Cohort: needs fossil record intervals'; result = this.statCtrl.runSummary(); break;
        case 'Diversity Dynamics': this.statusText = 'Diversity: needs fossil record intervals'; result = this.statCtrl.runSummary(); break;
        case 'FBD Process':
          result = this.statCtrl.runFBD(0.5, 0.2, 0.1, 10);
          this.plotTitle = 'FBD Diversity Curve';
          this.plotType = 'line';
          break;
        case 'Beta Diversity': result = this.statCtrl.runBetaDiv(); break;
        case 'Null Model': this.showNullModelDialog = true; return;
        case 'Import': this.showImportDialog = true; return;
        case 'Export': this.showExportDialog = true; return;
        default: this.statusText = name + ': not implemented'; return;
      }

      this.statusText = name + ' completed';
      this.addWidget(name);
    } catch (e) {
      this.statusText = name + ' error: ' + String(e).substring(0, 100);
    }
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'undo': this.doUndo(); break;
      case 'redo': this.doRedo(); break;
      case 'pca': this.showPCADialog = true; break;
      case 'nmds': this.showNMDSDialog = true; break;
      case 'diversity': this.handleAnalysis('Diversity Indices'); break;
      case 'export': this.showExportDialog = true; break;
      case 'theme':
        this.darkMode = !this.darkMode;
        this.storageDarkMode = this.darkMode;
        AppStorage.setOrCreate('darkMode', this.darkMode);
        break;
    }
  }

  private addWidget(name: string): void {
    if (!this.workspaceWidgets.includes(name)) {
      if (this.workspaceWidgets.length >= 8) this.workspaceWidgets.shift();
      this.workspaceWidgets.push(name);
    }
    this.currentWidget = this.workspaceWidgets.indexOf(name);
    if (this.currentWidget < 0) this.currentWidget = this.workspaceWidgets.length - 1;
  }

  private exportPlot(format: string): void {
    this.statusText = 'Exported ' + format;
  }
}

// ─── 鸿蒙特有：SplitContainer 分割面板 ──────────────────────────

@Component
struct SplitContainer {
  @BuilderParam left: () => void
  @BuilderParam right: () => void

  build() {
    Row() {
      this.left()
      Divider().vertical(true).width(1).color('#E4E7EB')
      this.right()
    }
    .width('100%')
    .height('100%')
  }
}

interface TabItem {
  name: string;
  icon: Resource;
}
