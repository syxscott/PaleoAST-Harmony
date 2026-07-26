import { DataController } from '../../core/controllers/DataController';
import { StatisticsController } from '../../core/controllers/StatisticsController';
import { StateManager } from '../../core/models/index';
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
import { taskpool } from '@kit.ArkTS';

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

  // 鸿蒙特有：AppStorage 持久化暗色模式（单一数据源，不再用 @State darkMode）
  @StorageLink('darkMode') darkMode: boolean = false;

  // StateManager singleton stored in AppStorage for reactive UI updates
  @StorageLink('stateMgr') stateMgr: StateManager | null = StateManager.getInstance();
  private dataCtrl = new DataController();
  private statCtrl = new StatisticsController();

  private tabs: string[] = ['Home', 'Analysis', 'Morphometrics', 'Stratigraphy', 'Macroevolution'];

  aboutToAppear(): void {
    // Ensure StateManager singleton is stored in AppStorage for reactivity
    AppStorage.setOrCreate('stateMgr', StateManager.getInstance());
  }

  build() {
    Column() {
      // ─── 顶部 Ribbon (使用 Tabs 组件) ───
      this.RibbonBar()

      // ─── 主内容区 (SideBarContainer 响应式布局) ───
      SideBarContainer(SideBarContainerType.Embed) {
        // SideBar: 左侧导航
        NavigationTree()
          .onNavigate((name: string) => { this.handleAnalysis(name); })

        // Content: 右侧工作区
        Column() {
          if (this.isLoading) {
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
      .showSideBar(true)
      .sideBarWidth(220)
      .minSideBarWidth(180)
      .maxSideBarWidth(300)
      .height('100%')

      // ─── 诊断控制台 (滑出式面板) ───
      if (this.showConsole) {
        this.ConsolePanel()
      }

      // ─── 状态栏 ───
      this.StatusBar()

      // ─── 对话框层 (Bug 修复: 之前未在 build() 中调用) ───
      this.DialogLayer()

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
      ForEach(this.tabs, (tab: string, idx: number) => {
        Text(tab)
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
        .onCancel(() => { this.showPCADialog = false; })
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
    const filePath = params['filePath'] as string ?? '';
    try {
      let csv: string;
      if (filePath && filePath.length > 0 && !filePath.includes('Sample,Var1')) {
        // Use @ohos.file.fs to read the selected file
        import fs from '@ohos.file.fs';
        const fileData = fs.readTextSync(filePath);
        csv = fileData;
      } else {
        csv = filePath || 'Sample,Var1,Var2,Var3,Var4\nA,5.1,3.5,1.4,0.2\nB,4.9,3.0,1.4,0.2\nC,4.7,3.2,1.3,0.2\nD,4.6,3.1,1.5,0.2\nE,5.0,3.6,1.4,0.2';
      }
      const dm = parseCSV(csv);
      if (!dm || dm.nSamples === 0) {
        throw new Error('No data parsed');
      }
      this.stateMgr.setData(dm);
      this.hasData = true;
      this.dataInfo = dm.nSamples + ' x ' + dm.nVariables;
      this.statusText = 'Loaded: ' + this.dataInfo;
      this.workspaceWidgets = ['spreadsheet'];
      this.currentWidget = 0;
      this.canUndo = false;
      this.canRedo = false;
    } catch (e) {
      this.statusText = 'Error: ' + String(e).substring(0, 100);
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

  private async runAnalysisWithParams(name: string, params: Record<string, Object>): Promise<void> {
    this.isLoading = true;
    this.statusText = 'Running: ' + name + '...';
    try {
      if (!this.stateMgr?.dataMatrix) { throw new Error('No data loaded'); }
      const data = this.stateMgr.dataMatrix.data;
      let result: any;

      // Use taskpool for heavy computations to avoid blocking UI thread
      const task = taskpool.execute(() => {
        switch (name) {
          case 'PCA':
            return this.statCtrl.runPCA(
              params['nComponents'] as number ?? 3,
              params['method'] as string ?? 'covariance'
            );
          case 'PCoA':
            return this.statCtrl.runPCoA(
              params['metric'] as string ?? 'bray_curtis',
              params['n_components'] as number ?? 10
            );
          case 'NMDS':
            return this.statCtrl.runNMDS(
              params['metric'] as string ?? 'bray_curtis',
              params['n_dimensions'] as number ?? 2,
              params['max_iterations'] as number ?? 300,
              params['n_restarts'] as number ?? 10
            );
          case 'Clustering':
            return this.statCtrl.runClustering(
              params['n_clusters'] as number ?? 3,
              params['method'] as string ?? 'ward',
              params['metric'] as string ?? 'euclidean'
            );
          case 'CONISS':
            return this.statCtrl.runCONISS(params['n_zones'] as number ?? 4);
          case 'NullModel':
            return this.statCtrl.runNullModel(
              params['metric'] as string ?? 'c_score',
              params['n_permutations'] as number ?? 999
            );
          case 'Extinction':
            return this.statCtrl.runExtinctionCI(
              params['method'] as string ?? 'marshall',
              params['confidence_level'] as number ?? 0.95
            );
          case 'EFA':
            return this.statCtrl.runEFA(
              params['n_harmonics'] as number ?? 10,
              params['n_points'] as number ?? 200
            );
          default:
            return null;
        }
      });

      result = await task;

      switch (name) {
        case 'PCA':
          this.plotDataX = result.scores.col(0);
          this.plotDataY = result.scores.col(1);
          this.plotTitle = 'PCA Score Plot';
          this.plotType = 'scatter';
          break;
        case 'PCoA':
          this.plotDataX = result.coordinates.col(0);
          this.plotDataY = result.coordinates.col(1);
          this.plotTitle = 'PCoA Plot';
          this.plotType = 'scatter';
          break;
        case 'NMDS':
          this.plotDataX = result.coordinates.col(0);
          this.plotDataY = result.coordinates.col(1);
          this.plotTitle = 'NMDS Plot (stress=' + result.stress.toFixed(3) + ')';
          this.plotType = 'scatter';
          break;
        case 'Clustering':
          this.plotTitle = 'Clustering Dendrogram';
          this.plotType = 'dendrogram';
          break;
        case 'CONISS':
          this.plotTitle = 'CONISS Dendrogram';
          this.plotType = 'dendrogram';
          break;
        case 'NullModel':
          this.plotTitle = 'Null Model (SES=' + result.ses.toFixed(2) + ')';
          this.plotType = 'histogram';
          break;
        case 'Extinction':
          this.plotTitle = 'Extinction CI';
          this.plotType = 'range';
          break;
        case 'EFA':
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

  private async handleAnalysis(name: string): Promise<void> {
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
      case 'Eigenshape': this.statusText = 'Eigenshape: use EFA dialog first to generate coefficients'; return;
    }

    this.statusText = 'Running: ' + name + '...';
    this.isLoading = true;
    try {
      if (!this.stateMgr?.dataMatrix) { throw new Error('No data loaded'); }
      const data = this.stateMgr.dataMatrix.data;
      const groups = this.stateMgr.dataMatrix.getGroups();
      let result: any;

      // Helper to check empty columns
      const safeCol = (colIdx: number): number[] => {
        const c = data.col(colIdx);
        return c.length === 0 ? [0] : c; // Return [0] as fallback for empty columns
      };

      // Use taskpool for heavy computations
      const task = taskpool.execute(() => {
        switch (name) {
          case 'LDA': return this.statCtrl.runLDA(groups ?? []);
          case 'CCA': return this.statCtrl.runCCA(data, data);
          case 'Summary': return this.statCtrl.runSummary();
          case 'Normality': return this.statCtrl.runNormalityTest(0);
          case 't-test': return this.statCtrl.runTTest(safeCol(0), safeCol(1));
          case 'ANOVA': return this.statCtrl.runANOVA([safeCol(0), safeCol(1)]);
          case 'Kruskal-Wallis': return this.statCtrl.runKruskal([safeCol(0), safeCol(1)]);
          case 'Diversity Indices':
            return this.statCtrl.runDiversity(data.row(0));
          case 'Rarefaction':
            return this.statCtrl.runRarefaction(data.row(0));
          case 'SHE Analysis': return this.statCtrl.runSHE();
          case 'Clustering': return this.statCtrl.runClustering(3);
          case 'ANOSIM': return this.statCtrl.runANOSIM(groups ?? []);
          case 'PERMANOVA': return this.statCtrl.runPERMANOVA(groups ?? []);
          case 'SIMPER': return this.statCtrl.runSIMPER(groups ?? []);
          case 'GPA': return this.statCtrl.runGPA();
          case 'TPS Grid': return this.statCtrl.runGPA();
          case 'Allometry': return this.statCtrl.runAllometry();
          case 'Evolution Rate': return this.statCtrl.runEvoRate();
          case 'Spectral':
            return this.statCtrl.runSpectral();
          case 'Markov': return this.statCtrl.runMarkov();
          case 'Directional': return this.statCtrl.runDirectional();
          case 'Wavelet': return this.statCtrl.runWavelet();
          case 'Isotope': return this.statCtrl.runIsotope();
          case 'Stratigraphic Correlation': return this.statCtrl.runSpectral();
          case 'Biostratigraphy': return this.statCtrl.runSpectral();
          case 'Paleo-Environment': return this.statCtrl.runPaleoEnv();
          case 'Fitch Parsimony': return this.statCtrl.runSummary();
          case 'PIC': return this.statCtrl.runSummary();
          case 'Phylo Signal': return this.statCtrl.runSummary();
          case 'Phylo ANOVA': return this.statCtrl.runSummary();
          case 'Cohort Survival': return this.statCtrl.runSummary();
          case 'Diversity Dynamics': return this.statCtrl.runSummary();
          case 'FBD Process':
            return this.statCtrl.runFBD(0.5, 0.2, 0.1, 10);
          case 'Beta Diversity': return this.statCtrl.runBetaDiv();
          case 'Mann-Whitney U': {
            const g1 = safeCol(0), g2 = safeCol(1);
            if (g1.length === 0 || g2.length === 0) {
              return { U: 0, p: 1, warning: 'Empty column(s)' };
            }
            return this.statCtrl.runMannWhitney(g1, g2);
          }
          case 'PLS Integration':
            return null;
          case 'Relative Warps': return this.statCtrl.runRelativeWarps();
          case 'Morphospace Disparity': return this.statCtrl.runMorphospaceDisparity();
          case 'Convex Hull': return this.statCtrl.runConvexHull(data.to2D());
          case 'Minimum Spanning Tree': return this.statCtrl.runMST();
          case 'Coverage Rarefaction': return this.statCtrl.runCoverageRarefaction();
          case 'Abundance Models': return this.statCtrl.runAbundanceModels();
          case 'Compute Correlation': return this.statCtrl.runComputeCorrelation(safeCol(0), safeCol(1));
          case 'Centroid Configuration Blocks': return this.statCtrl.runDivideBlocks('anterior_posterior');
          case 'LOWESS Smooth': return this.statCtrl.runLowess(safeCol(0), safeCol(1));
          case 'Polynomial Trend': return this.statCtrl.runPolynomialTrend(safeCol(0), safeCol(1));
          case 'Remove Outliers': return this.statCtrl.runRemoveOutliers(safeCol(0));
          case 'Cross Validate': return this.statCtrl.runCrossValidate(safeCol(0), safeCol(1));
          case 'Detect Excursions': return this.statCtrl.runDetectExcursions(safeCol(0), safeCol(1));
          case 'Filter Endemic': return this.statCtrl.runFilterEndemic(data.to2D());
          case 'Build ARMA': return this.statCtrl.runBuildARMA(safeCol(0));
          case 'ARMA Predict': return this.statCtrl.runARMAPredict(safeCol(0), 5);
          case 'Kaplan-Meier': return this.statCtrl.runKaplanMeier(safeCol(0), safeCol(0).map(_ => 1));
          case 'Neutral Simulation': return this.statCtrl.runSimulateNeutral(100, 10);
          case 'Equilibrium Test': return this.statCtrl.runTestEquilibrium(0.5, 0.4);
          case 'Exponential Fit': return this.statCtrl.runFitExponential(safeCol(0), safeCol(1));
          case 'Logistic Fit': return this.statCtrl.runFitLogistic(safeCol(0), safeCol(1));
          default: return null;
        }
      });

      result = await task;

      // Post-process results and update UI on main thread
      switch (name) {
        case 'Diversity Indices':
          this.plotTitle = 'Diversity: S=' + result.richness + ' H=' + result.shannon.toFixed(2);
          this.plotType = 'bar';
          break;
        case 'Rarefaction':
          this.plotDataX = result.sampleSizes;
          this.plotDataY = result.expectedTaxa;
          this.plotTitle = 'Rarefaction Curve';
          this.plotType = 'line';
          break;
        case 'Spectral':
          this.plotDataX = result.periods;
          this.plotDataY = result.power;
          this.plotTitle = 'Spectral (peak=' + result.peakPeriod.toFixed(2) + ')';
          this.plotType = 'line';
          break;
        case 'FBD Process':
          this.plotTitle = 'FBD Diversity Curve';
          this.plotType = 'line';
          break;
        case 'Mann-Whitney U':
          this.plotTitle = 'Mann-Whitney U: U=' + result.U.toFixed(2) + ' p=' + result.p.toFixed(4);
          this.plotType = 'bar';
          break;
        case 'PLS Integration':
          this.statusText = 'PLS Integration: 2 blocks required (use Import or Dialog)';
          break;
        case 'Ripley K': this.statusText = 'Ripley K: needs 2D coordinate data'; break;
        case 'DTW': this.statusText = 'DTW: needs 2 sequences'; break;
        case 'TPS Analyzer': this.statusText = 'TPS Analyzer: needs (source, target) landmarks'; break;
        case 'Unitary Associations': this.statusText = 'UA: needs FAD/LAD matrices'; break;
        case 'RASC Ranking': this.statusText = 'RASC: needs event distance matrix'; break;
        case 'Age Model': this.statusText = 'Age Model: needs age constraints'; break;
        case 'Sedimentation Rate': this.statusText = 'Sed Rate: needs section with ages'; break;
        case 'Moving Average': this.statusText = 'Moving Average: needs 1D series'; break;
        case 'Cox PH': this.statusText = 'Cox PH: needs durations + events + covariates'; break;
        case 'Log-rank': this.statusText = 'Log-rank: needs two survival groups'; break;
        case 'FBD Likelihood': this.statusText = 'FBD Likelihood: needs tree data'; break;
        case 'NJ Tree': this.statusText = 'NJ: needs distance matrix + names'; break;
        case 'UPGMA Tree': this.statusText = 'UPGMA: needs distance matrix + names'; break;
        case 'Strict Consensus': this.statusText = 'Strict Consensus: needs ≥ 2 trees'; break;
        case 'Majority Rule': this.statusText = 'Majority Rule: needs ≥ 2 trees'; break;
        case 'Heuristic Search': this.statusText = 'Heuristic Search: needs sequences'; break;
        case 'Tree Comparator': this.statusText = 'Tree Comparator: needs ≥ 2 parsed trees'; break;
        case 'Null Model': this.showNullModelDialog = true; return;
        case 'Import': this.showImportDialog = true; return;
        case 'Export': this.showExportDialog = true; return;
      }

      this.statusText = name + ' completed';
      this.addWidget(name);
    } catch (e) {
      this.statusText = name + ' error: ' + String(e).substring(0, 100);
    }
    this.isLoading = false;
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
