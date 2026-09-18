import { DataController } from '../../core/controllers/DataController';
import { StatisticsController } from '../../core/controllers/StatisticsController';
import { StateManager } from '../../core/models/index';
import { parseCSV } from '../../core/parsers/CSVParser';
import { PhyloNode } from '../../core/analysis/phylogenetics/index';
import { EventBus } from '../../core/utils/EventBus';
import { FilePickerHelper } from '../../core/io/FilePickerHelper';
import { DialogManager } from '../components/DialogManager';
import { NavigationTree } from '../components/NavigationTree';
import { Spreadsheet } from '../components/Spreadsheet';
import { PlotCanvas } from '../components/PlotCanvas';
import { FloatingToolbar } from '../components/FloatingToolbar';
import { RibbonBar } from '../components/RibbonBar';
import { WelcomeView } from '../components/WelcomeView';
import { WorkspaceView } from '../components/WorkspaceView';
import { LoadingView } from '../components/LoadingView';
import { ConsoleView } from '../components/ConsoleView';
import { StatusBar } from '../components/StatusBar';
import { DialogLayer } from '../components/DialogLayer';
import fs from '@ohos.file.fs';

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
  @State canUndo: boolean = false;
  @State canRedo: boolean = false;
  @State plotDataX: number[] = [];
  @State plotDataY: number[] = [];
  @State plotTitle: string = '';
  @State plotType: string = 'scatter';
  @State isLoading: boolean = false;
  @State progress: number = 0;
  @State loadError: string = ''; // 页面四态之一：error（HarmoneyOpenEye 模式）

  // 鸿蒙特有：AppStorage 持久化暗色模式
  @StorageLink('darkMode') darkMode: boolean = false;

  // 三折叠/折叠屏适配：EntryAbility 的 windowSizeChange 监听维护此值
  // (sm=折叠态 / md / lg=展开态 / xl)，断点切换只改布局属性、不重建组件树
  @StorageLink('breakpoint') breakPoint: string = 'md';
  @State sidebarOpen: boolean = false; // 小屏抽屉开关

  // StateManager singleton stored in AppStorage for reactive UI updates
  @StorageLink('stateMgr') stateMgr: StateManager | null = StateManager.getInstance();
  private dataCtrl = new DataController();
  private statCtrl = new StatisticsController();

  aboutToAppear(): void {
    // Ensure StateManager singleton is stored in AppStorage for reactivity
    AppStorage.setOrCreate('stateMgr', StateManager.getInstance());
  }

  build() {
    Column() {
      // ─── 顶部 Ribbon ───
      RibbonBar({
        currentTab: $currentTab,
        darkMode: $darkMode,
        canUndo: $canUndo,
        canRedo: $canRedo,
        showConsole: $showConsole,
        isSmallScreen: this.breakPoint === 'sm',
        onToggleSidebar: () => {
          animateTo({ duration: 250, curve: Curve.EaseInOut }, () => {
            this.sidebarOpen = !this.sidebarOpen;
          });
        },
        onUndo: () => { this.doUndo(); },
        onRedo: () => { this.doRedo(); }
      })

      // ─── 主内容区 (SideBarContainer 响应式布局) ───
      // 折叠态(sm)：侧栏收起为抽屉，由 Ribbon 汉堡按钮打开；
      // 展开态(md/lg/xl)：侧栏常驻，宽度随断点放大。
      SideBarContainer(SideBarContainerType.Embed) {
        // SideBar: 左侧导航
        NavigationTree()
          .onNavigate((name: string) => { this.handleAnalysis(name); })

        // Content: 右侧工作区
        Column() {
          if (this.isLoading) {
            LoadingView({
              statusText: $statusText,
              progress: $progress
            })
          } else if (this.loadError.length > 0) {
            // 错误态：可重试（HarmoneyOpenEye 四态容器模式）
            Column() {
              Text('⚠️').fontSize(40).margin({ bottom: 8 })
              Text('Failed to load data').fontSize(16).fontWeight(FontWeight.Medium).fontColor('#E74C3C').margin({ bottom: 4 })
              Text(this.loadError).fontSize(11).fontColor('#7F8C8D').margin({ bottom: 16 }).textAlign(TextAlign.Center).width('80%')
              Button('Retry Import').backgroundColor('#3498DB').fontColor('#FFFFFF')
                .onClick(() => { this.loadError = ''; DialogManager.open('Import'); })
            }.width('100%').height('100%').justifyContent(FlexAlign.Center)
          } else if (!this.hasData) {
            WelcomeView({
              darkMode: $darkMode
            })
          } else {
            WorkspaceView({
              currentWidget: $currentWidget,
              workspaceWidgets: $workspaceWidgets,
              plotDataX: $plotDataX,
              plotDataY: $plotDataY,
              plotTitle: $plotTitle,
              plotType: $plotType,
              darkMode: $darkMode
            })
          }
        }
        .layoutWeight(1)
        .height('100%')
      }
      .showSideBar(this.breakPoint === 'sm' ? this.sidebarOpen : true)
      .sideBarWidth(this.breakPoint === 'lg' || this.breakPoint === 'xl' ? 280 : 240)
      .minSideBarWidth(180)
      .maxSideBarWidth(320)
      // 防挤压：内容区低于此宽度时系统自动收起侧栏（折叠动画期间平滑）
      .minContentWidth(this.breakPoint === 'sm' ? 0 : 480)
      .autoHide(true)
      .height('100%')

      // ─── 诊断控制台 (滑出式面板) ───
      if (this.showConsole) {
        ConsoleView({
          showConsole: $showConsole,
          darkMode: $darkMode
        })
      }

      // ─── 状态栏 ───
      StatusBar({
        statusText: $statusText,
        hasData: $hasData,
        dataInfo: $dataInfo,
        darkMode: $darkMode
      })

      // ─── 对话框层（Tag 注册表模式：按名字开关，无逐对话框布尔量） ───
      DialogLayer({
        onImportConfirm: (params: Record<string, Object>) => { this.loadFile(params); },
        onExportConfirm: (params: Record<string, Object>) => { this.exportFile(params); },
        onAnalysisConfirm: (name: string, params: Record<string, Object>) => { this.runAnalysisWithParams(name, params); }
      })

      // ─── 浮动工具栏 ───
      FloatingToolbar({ onAction: (action: string) => { this.handleAction(action); } })
        .position({ x: '80%', y: '80%' })
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

  /**
   * @Entry 页面返回键生命周期（API 7+）：优先关对话框/控制台，返回 true 表示已消费。
   */
  onBackPress(): boolean {
    if (DialogManager.isOpen()) { DialogManager.dismiss(); return true; }
    if (this.showConsole) { this.showConsole = false; return true; }
    return false;
  }

  // ─── 业务逻辑方法 ──────────────────────────────────────────────

  private doUndo(): void {
    if (this.stateMgr.undo()) {
      this.statusText = 'Undo';
      this.canUndo = this.stateMgr.canUndo();
      this.canRedo = this.stateMgr.canRedo();
      // Matrix 内容已回退但不可观察——广播刷新，Spreadsheet 重建行缓存
      EventBus.getInstance().emit('data_changed');
    }
  }

  private doRedo(): void {
    if (this.stateMgr.redo()) {
      this.statusText = 'Redo';
      this.canUndo = this.stateMgr.canUndo();
      this.canRedo = this.stateMgr.canRedo();
      EventBus.getInstance().emit('data_changed');
    }
  }

  private loadFile(params: Record<string, Object>): void {
    this.isLoading = true;
    this.loadError = '';
    this.statusText = 'Loading...';
    const filePath = params['filePath'] as string ?? '';
    const delimiter = params['delimiter'] as string ?? ',';
    const hasHeader = params['hasHeader'] as boolean ?? true;
    const hasRowLabels = params['hasRowLabels'] as boolean ?? true;
    try {
      let csv: string;
      if (filePath.length > 0) {
        // Use @ohos.file.fs to read the selected file
        csv = fs.readTextSync(filePath);
      } else {
        // no path given: load the built-in demo table
        csv = 'Sample,Var1,Var2,Var3,Var4\nA,5.1,3.5,1.4,0.2\nB,4.9,3.0,1.4,0.2\nC,4.7,3.2,1.3,0.2\nD,4.6,3.1,1.5,0.2\nE,5.0,3.6,1.4,0.2';
      }
      const dm = parseCSV(csv, delimiter, hasHeader, hasRowLabels);
      if (!dm || dm.nSamples === 0) {
        throw new Error('No data parsed');
      }
      dm.currentFile = filePath;
      this.stateMgr.setData(dm);
      this.stateMgr.setCurrentFile(filePath);
      this.hasData = true;
      this.dataInfo = dm.nSamples + ' x ' + dm.nVariables;
      this.statusText = 'Loaded: ' + this.dataInfo;
      this.workspaceWidgets = ['spreadsheet'];
      this.currentWidget = 0;
      this.canUndo = false;
      this.canRedo = false;
      // 通知已挂载的 WorkspaceView/Spreadsheet 换用新 DataMatrix
      EventBus.getInstance().emit('data_changed');
    } catch (e) {
      this.loadError = String(e).substring(0, 160);
      this.statusText = 'Error: ' + String(e).substring(0, 100);
    }
    this.isLoading = false;
  }

  private exportFile(params: Record<string, Object>): void {
    const format = params['format'] as string ?? 'CSV';
    if (format === 'Script') {
      // 可复现分析脚本导出（paleopal UI↔脚本平价）
      FilePickerHelper.saveFile(this.buildAnalysisScript(), 'paleoast_analysis_script.json')
        .then((uri: string | null) => {
          this.statusText = uri ? 'Script saved to ' + uri : 'Script export cancelled';
        })
        .catch((e: Error) => { this.statusText = 'Script export error: ' + String(e).substring(0, 80); });
      return;
    }
    try {
      const content = this.dataCtrl.exportCSV(format === 'TSV' ? '\t' : ',');
      const ext = format === 'TSV' ? 'tsv' : 'csv';
      // 真导出：系统保存对话框 + 落盘（FilePickerHelper.saveFile 内部写文件）
      FilePickerHelper.saveFile(content, 'paleoast_export.' + ext)
        .then((uri: string | null) => {
          this.statusText = uri ? 'Saved to ' + uri : 'Export cancelled';
        })
        .catch((e: Error) => {
          this.statusText = 'Export error: ' + String(e).substring(0, 80);
        });
    } catch (e) { this.statusText = 'Export error: ' + e; }
  }

  // ─── 同步计算核心（原 taskpool 闭包体，避免跨线程序列化组件 this） ───

  private runDialogAnalysisCore(name: string, params: Record<string, Object>): any {
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
      // Extended wiring: analyses opened from their dialogs
      case 'Summary':
      case 'Univariate':
        return this.statCtrl.runSummary();
      case 'Diversity Indices':
        return this.statCtrl.runDiversity(this.stateMgr.dataMatrix.data.row(params['sample_index'] as number ?? 0));
      case 'Rarefaction':
        return this.statCtrl.runRarefaction(this.stateMgr.dataMatrix.data.row(params['sample_index'] as number ?? 0));
      case 'SIMPER':
        return this.statCtrl.runSIMPER(this.stateMgr.dataMatrix.getGroups() ?? []);
      case 'LDA':
        return this.statCtrl.runLDA(this.stateMgr.dataMatrix.getGroups() ?? []);
      case 'ANOSIM':
        return this.statCtrl.runANOSIM(
          this.stateMgr.dataMatrix.getGroups() ?? [],
          params['metric'] as string ?? 'bray_curtis',
          params['n_permutations'] as number ?? 999
        );
      case 'PERMANOVA':
        return this.statCtrl.runPERMANOVA(this.stateMgr.dataMatrix.getGroups() ?? []);
      case 'CCA':
        return this.statCtrl.runCCA(this.stateMgr.dataMatrix.data, this.stateMgr.dataMatrix.data);
      case 'GPA':
        return this.statCtrl.runGPA();
      case 'Allometry':
        return this.statCtrl.runAllometry();
      case 'Evolution Rate':
        return this.statCtrl.runEvoRate();
      case 'Spectral':
        return this.statCtrl.runSpectral();
      case 'Markov':
        return this.statCtrl.runMarkov();
      case 'Directional':
        return this.statCtrl.runDirectional();
      case 'Isotope':
        return this.statCtrl.runIsotope();
      case 'Stratigraphic Correlation':
        return this.statCtrl.runComputeCorrelation(
          this.stateMgr.dataMatrix.data.col(0),
          this.stateMgr.dataMatrix.data.col(Math.min(1, this.stateMgr.dataMatrix.data.cols - 1))
        );
      case 'Biostratigraphy':
        return this.statCtrl.runUnitaryAssociations(
          this.stateMgr.dataMatrix.data.to2D(), this.stateMgr.dataMatrix.data.to2D()
        );
      case 'Paleo-Environment':
        return this.statCtrl.runPaleoEnv();
      case 'Wavelet':
        return this.statCtrl.runWavelet();
      case 'PIC': {
        const traits: Record<string, number> = {};
        const labels = this.stateMgr.dataMatrix.rowLabels;
        const vals = this.stateMgr.dataMatrix.data.col(0);
        for (let i = 0; i < labels.length; i++) traits[labels[i]] = vals[i] ?? 0;
        return this.statCtrl.runPIC(new PhyloNode('root', 0, false), traits);
      }
      case 'Phylo Signal': {
        const traits: Record<string, number> = {};
        const labels = this.stateMgr.dataMatrix.rowLabels;
        const vals = this.stateMgr.dataMatrix.data.col(0);
        for (let i = 0; i < labels.length; i++) traits[labels[i]] = vals[i] ?? 0;
        return this.statCtrl.runPhylogeneticSignalUnified(new PhyloNode('root', 0, false), traits);
      }
      case 'Phylo ANOVA': {
        const traits: Record<string, number> = {};
        const labels = this.stateMgr.dataMatrix.rowLabels;
        const vals = this.stateMgr.dataMatrix.data.col(0);
        for (let i = 0; i < labels.length; i++) traits[labels[i]] = vals[i] ?? 0;
        return this.statCtrl.runPhyloANOVA(new PhyloNode('root', 0, false), traits, {});
      }
      case 'Beta Diversity':
        return this.statCtrl.runBetaDiv();
      case 'TPS Grid':
        return this.statCtrl.runTPSAnalyze(
          this.stateMgr.dataMatrix.data.to2D(), this.stateMgr.dataMatrix.data.to2D()
        );
      default:
        return null;
    }
  }

  private runQuickAnalysisCore(name: string): any {
    if (!this.stateMgr?.dataMatrix) { return null; }
    const data = this.stateMgr.dataMatrix.data;
    const groups = this.stateMgr.dataMatrix.getGroups();
    const dm = this.stateMgr.dataMatrix;

    // Helper to check empty columns
    const safeCol = (colIdx: number): number[] => {
      const c = data.col(colIdx);
      return c.length === 0 ? [0] : c; // Return [0] as fallback for empty columns
    };

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
      case 'TPS Grid': return this.statCtrl.runTPSAnalyze(data.to2D(), data.to2D());
      case 'Allometry': return this.statCtrl.runAllometry();
      case 'Evolution Rate': return this.statCtrl.runEvoRate();
      case 'Spectral':
        return this.statCtrl.runSpectral();
      case 'Markov': return this.statCtrl.runMarkov();
      case 'Directional': return this.statCtrl.runDirectional();
      case 'Wavelet': return this.statCtrl.runWavelet();
      case 'Isotope': return this.statCtrl.runIsotope();
      case 'Stratigraphic Correlation':
        // correlate column pairs of the loaded table by height (column 0)
        return this.statCtrl.runStratCorr([{
          name: 'S1', heights: data.col(0), values: safeCol(1),
        }, {
          name: 'S2', heights: data.col(0), values: safeCol(Math.min(2, data.cols - 1)),
        }]);
      case 'Biostratigraphy':
        return this.statCtrl.runUnitaryAssociations(data.to2D(), data.to2D(), undefined, undefined);
      case 'Paleo-Environment': return this.statCtrl.runPaleoEnv();
      case 'Fitch Parsimony': {
        const seqs: Record<string, string> = {};
        for (let i = 0; i < dm.rowLabels.length; i++) seqs[dm.rowLabels[i]] = String(Math.round(safeCol(0)[i] ?? 0));
        return this.statCtrl.runFitch(new PhyloNode('root', 0, false), seqs);
      }
      case 'PIC': {
        const traits: Record<string, number> = {};
        for (let i = 0; i < dm.rowLabels.length; i++) traits[dm.rowLabels[i]] = safeCol(0)[i] ?? 0;
        return this.statCtrl.runPIC(new PhyloNode('root', 0, false), traits);
      }
      case 'Phylo Signal': {
        const traits: Record<string, number> = {};
        for (let i = 0; i < dm.rowLabels.length; i++) traits[dm.rowLabels[i]] = safeCol(0)[i] ?? 0;
        return this.statCtrl.runPhylogeneticSignalUnified(new PhyloNode('root', 0, false), traits);
      }
      case 'Phylo ANOVA': {
        const traits: Record<string, number> = {};
        for (let i = 0; i < dm.rowLabels.length; i++) traits[dm.rowLabels[i]] = safeCol(0)[i] ?? 0;
        return this.statCtrl.runPhyloANOVA(new PhyloNode('root', 0, false), traits, {});
      }
      case 'Cohort Survival': {
        const records: [number, number][] = [];
        const colA = safeCol(0), colB = safeCol(1);
        for (let i = 0; i < Math.min(colA.length, colB.length); i++) records.push([colA[i], colB[i]]);
        return this.statCtrl.runCohort(records, [[0, 1], [1, 2], [2, 3]]);
      }
      case 'Diversity Dynamics': {
        const records: [number, number][] = [];
        const colA = safeCol(0), colB = safeCol(1);
        for (let i = 0; i < Math.min(colA.length, colB.length); i++) records.push([colA[i], colB[i]]);
        return this.statCtrl.runDiversityDyn(records, [[0, 1], [1, 2], [2, 3]]);
      }
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
  }

  // ─── 可复现分析脚本（paleopal 模式：GUI 操作 ↔ 脚本双输出） ───
  private analysisHistory: { analysis: string; params: Record<string, Object>; at: string }[] = [];

  private recordAnalysis(name: string, params: Record<string, Object>): void {
    this.analysisHistory.push({
      analysis: name,
      params,
      at: new Date().toISOString(),
    });
    if (this.analysisHistory.length > 200) this.analysisHistory.shift();
  }

  /**
   * 生成可复现分析脚本：按会话顺序列出每一步的分析名与参数，
   * 可在 PC 上审阅或回放（paleopal 的 UI↔脚本平价思想）。
   */
  private buildAnalysisScript(): string {
    const dm = this.stateMgr?.dataMatrix;
    const header = [
      '// PaleoAST-Harmony reproducible analysis script',
      '// Generated: ' + new Date().toISOString(),
      dm ? '// Data: ' + dm.nSamples + ' x ' + dm.nVariables + (dm.currentFile ? ' (' + dm.currentFile + ')' : '') : '// Data: not loaded',
      '// Steps: ' + this.analysisHistory.length,
      '',
    ];
    const steps = this.analysisHistory.map((h, i) =>
      JSON.stringify({ step: i + 1, analysis: h.analysis, params: h.params }, null, 2)
    );
    return header.join('
') + '
' + (steps.length > 0 ? steps.join(',
') : '[]');
  }

  private async runAnalysisWithParams(name: string, params: Record<string, Object>): Promise<void> {
    this.isLoading = true;
    this.statusText = 'Running: ' + name + '...';
    this.recordAnalysis(name, params);
    try {
      if (!this.stateMgr?.dataMatrix) { throw new Error('No data loaded'); }
      let result: any;

      // Run synchronously: closures capturing component `this` cannot be
      // serialized across threads via taskpool (would crash at runtime).
      result = this.runDialogAnalysisCore(name, params);

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
        default: {
          // Generic result handling for the extended dialog-routed analyses:
          // show a first-two-column scatter/line when the result exposes
          // coordinates, otherwise leave the title line for the status bar.
          if (result && typeof result === 'object') {
            const r = result as Record<string, Object>;
            const coords = r['coordinates'] as number[][] | undefined;
            const scores = r['scores'] as number[][] | undefined;
            if (scores && Array.isArray(scores)) {
              this.plotDataX = scores.map((row: number[]) => row[0]);
              this.plotDataY = scores.map((row: number[]) => row[1]);
              this.plotTitle = name;
              this.plotType = 'scatter';
            } else if (coords && Array.isArray(coords)) {
              this.plotDataX = coords.map((row: number[]) => row[0]);
              this.plotDataY = coords.map((row: number[]) => row[1]);
              this.plotTitle = name;
              this.plotType = 'scatter';
            } else {
              this.plotTitle = name + ' result';
              this.plotType = 'line';
            }
          }
          break;
        }
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

    // 小屏（折叠态）：选择分析后自动收起抽屉侧栏，让出内容宽度
    if (this.breakPoint === 'sm' && this.sidebarOpen) {
      animateTo({ duration: 250, curve: Curve.EaseInOut }, () => {
        this.sidebarOpen = false;
      });
    }

    switch (name) {
      case 'PCA': DialogManager.open('PCA'); return;
      case 'PCoA': DialogManager.open('PCoA'); return;
      case 'NMDS': DialogManager.open('NMDS'); return;
      case 'Hierarchical Clustering': DialogManager.open('Clustering'); return;
      case 'CONISS': DialogManager.open('CONISS'); return;
      case 'Null Models': DialogManager.open('NullModel'); return;
      case 'Extinction CI': DialogManager.open('Extinction'); return;
      case 'EFA': DialogManager.open('EFA'); return;
      // Extended wiring: every remaining analysis opens its dialog
      case 'Univariate': DialogManager.open('Univariate'); return;
      case 'Diversity Indices': DialogManager.open('Diversity Indices'); return;
      case 'Rarefaction': DialogManager.open('Rarefaction'); return;
      case 'SIMPER': DialogManager.open('SIMPER'); return;
      case 'LDA': DialogManager.open('LDA'); return;
      case 'ANOSIM': DialogManager.open('ANOSIM'); return;
      case 'PERMANOVA': DialogManager.open('PERMANOVA'); return;
      case 'CCA': DialogManager.open('CCA'); return;
      case 'GPA': DialogManager.open('GPA'); return;
      case 'Allometry': DialogManager.open('Allometry'); return;
      case 'Evolution Rate': DialogManager.open('Evolution Rate'); return;
      case 'Spectral': DialogManager.open('Spectral'); return;
      case 'Markov': DialogManager.open('Markov'); return;
      case 'Directional': DialogManager.open('Directional'); return;
      case 'Isotope': DialogManager.open('Isotope'); return;
      case 'Stratigraphic Correlation': DialogManager.open('Stratigraphic Correlation'); return;
      case 'Biostratigraphy': DialogManager.open('Biostratigraphy'); return;
      case 'Paleo-Environment': DialogManager.open('Paleo-Environment'); return;
      case 'Wavelet': DialogManager.open('Wavelet'); return;
      case 'PIC': DialogManager.open('PIC'); return;
      case 'Phylo Signal': DialogManager.open('Phylo Signal'); return;
      case 'Phylo ANOVA': DialogManager.open('Phylo ANOVA'); return;
      case 'Beta Diversity': DialogManager.open('Beta Diversity'); return;
      case 'TPS Grid': DialogManager.open('TPS Grid'); return;
      case 'Eigenshape': this.statusText = 'Eigenshape: use EFA dialog first to generate coefficients'; return;
    }

    // 记录分析历史（可复现脚本用；对话框分析在 runAnalysisWithParams 里记录）
    this.recordAnalysis(name, {});

    this.statusText = 'Running: ' + name + '...';
    this.isLoading = true;
    try {
      if (!this.stateMgr?.dataMatrix) { throw new Error('No data loaded'); }
      let result: any;

      // Run synchronously: closures capturing component `this` cannot be
      // serialized across threads via taskpool (would crash at runtime).
      result = this.runQuickAnalysisCore(name);

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
        case 'Null Model': DialogManager.open('NullModel'); return;
        case 'Import': DialogManager.open('Import'); return;
        case 'Export': DialogManager.open('Export'); return;
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
      case 'pca': DialogManager.open('PCA'); break;
      case 'nmds': DialogManager.open('NMDS'); break;
      case 'diversity': this.handleAnalysis('Diversity Indices'); break;
      case 'export': DialogManager.open('Export'); break;
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
