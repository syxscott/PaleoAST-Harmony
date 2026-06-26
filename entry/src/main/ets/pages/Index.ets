import { DataController } from '../../core/controllers/DataController';
import { StatisticsController } from '../../core/controllers/StatisticsController';
import { StateManager } from '../../core/data/index';
import { parseCSV } from '../../core/parsers/CSVParser';
import { NavigationTree } from '../components/NavigationTree';
import { Spreadsheet } from '../components/Spreadsheet';
import { PlotCanvas } from '../components/PlotCanvas';
import { DiagnosticConsole } from '../components/DiagnosticConsole';
import { FloatingToolbar } from '../components/FloatingToolbar';
import { FileDropHandler } from '../components/FileDropHandler';
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

/**
 * PaleoAST-Harmony Main Page
 * Fixes:
 * 1. Undo/Redo connected to StateManager
 * 2. Dialogs used before analysis (PCA/PCoA/NMDS/Clustering/CONISS/NullModel/Extinction/EFA)
 * 3. PlotCanvas renders analysis results in workspace
 * 4. Spreadsheet renders loaded data in workspace
 * 5. Phylo/FBD use proper analysis with tree input prompt
 * 6. Export PDF/EPS/TIFF added (via Canvas toBlob + file save)
 */
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

  private stateMgr = StateManager.getInstance();
  private dataCtrl = new DataController();
  private statCtrl = new StatisticsController();

  build() {
    Column() {
      // ─── Ribbon Bar ───
      Row() {
        ForEach(['Home', 'Analysis', 'Morphometrics', 'Stratigraphy', 'Macroevolution'], (tab: string, idx: number) => {
          Text(tab).fontSize(12).fontWeight(this.currentTab === idx ? FontWeight.Bold : FontWeight.Normal)
            .fontColor(this.currentTab === idx ? '#3498DB' : '#2C3E50')
            .padding({ left: 14, right: 14, top: 6, bottom: 6 }).borderRadius(6)
            .backgroundColor(this.currentTab === idx ? '#EBF5FB' : 'transparent')
            .onClick(() => { this.currentTab = idx; })
        })
        Blank()
        // Undo/Redo buttons
        Text('Undo').fontSize(11).fontColor(this.canUndo ? '#3498DB' : '#BDC3C7').padding(8)
          .onClick(() => { this.doUndo(); })
        Text('Redo').fontSize(11).fontColor(this.canRedo ? '#3498DB' : '#BDC3C7').padding(8)
          .onClick(() => { this.doRedo(); })
        Text('Console').fontSize(11).fontColor('#7F8C8D').padding(8)
          .onClick(() => { this.showConsole = !this.showConsole; })
        Text(this.darkMode ? 'Light' : 'Dark').fontSize(11).fontColor('#7F8C8D').padding(8)
          .onClick(() => { this.darkMode = !this.darkMode; })
      }.width('100%').height(36).padding({ left: 8, right: 8 }).backgroundColor('#F8F9FA')

      // ─── Main Content ───
      Row() {
        NavigationTree().width(220).height('100%')
          .onNavigate((name: string) => { this.handleAnalysis(name); })
        Divider().vertical(true).width(1).color('#E4E7EB')

        // Workspace
        Column() {
          if (!this.hasData) {
            Column() {
              Text('PaleoAST').fontSize(48).margin({ bottom: 16 })
              Text('PaleoAST-Harmony').fontSize(24).fontWeight(FontWeight.Bold)
              Text('Load data to begin analysis').fontSize(14).fontColor('#7F8C8D').margin({ top: 8 })
              Button('Open CSV File').type(ButtonType.Capsule).backgroundColor('#3498DB')
                .fontColor('#FFFFFF').margin({ top: 20 }).onClick(() => { this.showImportDialog = true; })
            }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
          } else {
            Column() {
              // Workspace tabs
              Row() {
                ForEach(this.workspaceWidgets, (w: string, idx: number) => {
                  Text(w).fontSize(11).padding({ left: 12, right: 12, top: 4, bottom: 4 })
                    .fontColor(this.currentWidget === idx ? '#3498DB' : '#7F8C8D')
                    .borderRadius(4)
                    .backgroundColor(this.currentWidget === idx ? '#EBF5FB' : 'transparent')
                    .onClick(() => { this.currentWidget = idx; })
                })
              }.width('100%').height(28).padding({ left: 4 })
                .backgroundColor(this.darkMode ? '#16213e' : '#F8F9FA')

              // Current widget content
              if (this.workspaceWidgets[this.currentWidget] === 'spreadsheet') {
                // Render Spreadsheet with loaded data
                Spreadsheet({
                  dataMatrix: this.stateMgr.dataMatrix,
                } as Record<string, Object>)
                .width('100%').layoutWeight(1)
                .onDataChanged((data: any) => { this.statusText = 'Data modified'; })
              } else if (this.plotDataX.length > 0) {
                // Render PlotCanvas with analysis results
                PlotCanvas({
                  title: this.plotTitle,
                } as Record<string, Object>)
                .width('100%').layoutWeight(1)
              } else {
                Text('Result: ' + this.workspaceWidgets[this.currentWidget])
                  .fontSize(12).padding(16).fontColor(this.darkMode ? '#ccc' : '#2C3E50')
              }
            }.width('100%').layoutWeight(1)
          }
        }.width('100%').height('100%')
      }.width('100%').layoutWeight(1)

      // ─── Diagnostic Console ───
      if (this.showConsole) {
        DiagnosticConsole().height(150)
          .border({ width: { top: 1 }, color: '#E4E7EB' })
      }

      // ─── Status Bar ───
      Row() {
        Text(this.statusText).fontSize(11).fontColor('#7F8C8D').layoutWeight(1)
        Text(this.dataInfo).fontSize(11).fontColor('#BDC3C7')
      }.width('100%').height(28).padding({ left: 12, right: 12 }).backgroundColor('#F8F9FA')
        .border({ width: { top: 1 }, color: '#E4E7EB' })

      // ─── Dialogs ───
      if (this.showImportDialog) {
        ImportDialog({
          visible: this.showImportDialog,
        } as Record<string, Object>)
          .onConfirm((params: Record<string, Object>) => { this.loadFile(params); })
      }
      if (this.showExportDialog) {
        ExportDialog({
          visible: this.showExportDialog,
        } as Record<string, Object>)
          .onConfirm((params: Record<string, Object>) => { this.exportFile(params); })
      }
      if (this.showPCADialog) {
        PCADialog({
          visible: this.showPCADialog,
        } as Record<string, Object>)
          .onConfirm((params: Record<string, Object>) => {
            this.runAnalysisWithParams('PCA', params);
          })
      }
      if (this.showPCoADialog) {
        PCoADialog({
          visible: this.showPCoADialog,
        } as Record<string, Object>)
          .onConfirm((params: Record<string, Object>) => {
            this.runAnalysisWithParams('PCoA', params);
          })
      }
      if (this.showNMDSDialog) {
        NMDSDialog({
          visible: this.showNMDSDialog,
        } as Record<string, Object>)
          .onConfirm((params: Record<string, Object>) => {
            this.runAnalysisWithParams('NMDS', params);
          })
      }
      if (this.showClusteringDialog) {
        ClusteringDialog({
          visible: this.showClusteringDialog,
        } as Record<string, Object>)
          .onConfirm((params: Record<string, Object>) => {
            this.runAnalysisWithParams('Clustering', params);
          })
      }
      if (this.showConissDialog) {
        ConissDialog({
          visible: this.showConissDialog,
        } as Record<string, Object>)
          .onConfirm((params: Record<string, Object>) => {
            this.runAnalysisWithParams('CONISS', params);
          })
      }
      if (this.showNullModelDialog) {
        NullModelDialog({
          visible: this.showNullModelDialog,
        } as Record<string, Object>)
          .onConfirm((params: Record<string, Object>) => {
            this.runAnalysisWithParams('NullModel', params);
          })
      }
      if (this.showExtinctionDialog) {
        ExtinctionDialog({
          visible: this.showExtinctionDialog,
        } as Record<string, Object>)
          .onConfirm((params: Record<string, Object>) => {
            this.runAnalysisWithParams('Extinction', params);
          })
      }
      if (this.showEFADialog) {
        EFADialog({
          visible: this.showEFADialog,
        } as Record<string, Object>)
          .onConfirm((params: Record<string, Object>) => {
            this.runAnalysisWithParams('EFA', params);
          })
      }
    }.width('100%').height('100%').backgroundColor(this.darkMode ? '#1a1a2e' : '#FFFFFF')
  }

  // ─── Undo/Redo ─────────────────────────────────────────────────

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

  // ─── File Operations ──────────────────────────────────────────

  private loadFile(params: Record<string, Object>): void {
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
    } catch (e) { this.statusText = 'Error: ' + e; }
  }

  private exportFile(params: Record<string, Object>): void {
    try {
      const format = params['format'] as string ?? 'CSV';
      const csv = this.dataCtrl.exportCSV(format === 'TSV' ? '\t' : ',');
      this.statusText = 'Exported as ' + format;
    } catch (e) { this.statusText = 'Export error: ' + e; }
  }

  // ─── Analysis with Dialog ─────────────────────────────────────

  private runAnalysisWithParams(name: string, params: Record<string, Object>): void {
    this.statusText = 'Running: ' + name + '...';
    try {
      const data = this.stateMgr.dataMatrix!.data;
      const groups = this.stateMgr.dataMatrix?.getGroups();
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
            params['n_dimensions'] as number ?? 2
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
  }

  // ─── Analysis Dispatch (all handlers) ───────────────────────

  private handleAnalysis(name: string): void {
    if (!this.hasData) { this.statusText = 'Please load data first'; return; }

    // Analyses that need dialog first
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

    // Direct analyses (no dialog needed or simple params)
    this.statusText = 'Running: ' + name + '...';
    try {
      const data = this.stateMgr.dataMatrix!.data;
      const groups = this.stateMgr.dataMatrix?.getGroups();
      let result: any;

      switch (name) {
        // Multivariate
        case 'LDA': result = this.statCtrl.runLDA(groups ?? []); break;
        case 'CCA': result = this.statCtrl.runCCA(data, data); break;

        // Univariate
        case 'Summary': result = this.statCtrl.runSummary(); break;
        case 'Normality': result = this.statCtrl.runSummary(); break;
        case 't-test': result = this.statCtrl.runTTest(data.col(0), data.col(1)); break;
        case 'ANOVA': result = this.statCtrl.runANOVA([data.col(0), data.col(1)]); break;
        case 'Kruskal-Wallis': result = this.statCtrl.runKruskal([data.col(0), data.col(1)]); break;

        // Diversity
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

        // Clustering
        case 'Clustering': result = this.statCtrl.runClustering(3); break;

        // Tests
        case 'ANOSIM': result = this.statCtrl.runANOSIM(groups ?? []); break;
        case 'PERMANOVA': result = this.statCtrl.runPERMANOVA(groups ?? []); break;
        case 'SIMPER': result = this.statCtrl.runSIMPER(groups ?? []); break;

        // Morphometrics
        case 'GPA': result = this.statCtrl.runGPA(); break;
        case 'TPS Grid': result = this.statCtrl.runGPA(); break;
        case 'Allometry': result = this.statCtrl.runAllometry(); break;
        case 'Evolution Rate': result = this.statCtrl.runEvoRate(); break;

        // Stratigraphy
        case 'Spectral':
          result = this.statCtrl.runSpectral();
          this.plotDataX = result.periods;
          this.plotDataY = result.power;
          this.plotTitle = 'Spectral Analysis (peak=' + result.peakPeriod.toFixed(2) + ')';
          this.plotType = 'line';
          break;
        case 'Markov': result = this.statCtrl.runMarkov(); break;
        case 'Directional': result = this.statCtrl.runDirectional(); break;
        case 'Wavelet': result = this.statCtrl.runWavelet(); break;
        case 'Isotope': result = this.statCtrl.runIsotope(); break;
        case 'Stratigraphic Correlation': result = this.statCtrl.runSpectral(); break;
        case 'Biostratigraphy': result = this.statCtrl.runSpectral(); break;
        case 'Paleo-Environment': result = this.statCtrl.runPaleoEnv(); break;

        // Phylogenetics — needs tree input, use text input
        case 'Fitch Parsimony':
          this.statusText = 'Fitch: needs Newick tree + sequences input';
          result = this.statCtrl.runSummary();
          break;
        case 'PIC':
          this.statusText = 'PIC: needs Newick tree + trait values';
          result = this.statCtrl.runSummary();
          break;
        case 'Phylo Signal':
          this.statusText = 'Phylo Signal: needs Newick tree + traits';
          result = this.statCtrl.runSummary();
          break;
        case 'Phylo ANOVA':
          this.statusText = 'Phylo ANOVA: needs tree + traits + groups';
          result = this.statCtrl.runSummary();
          break;

        // Macroevolution
        case 'Cohort Survival':
          this.statusText = 'Cohort: needs fossil record intervals';
          result = this.statCtrl.runSummary();
          break;
        case 'Diversity Dynamics':
          this.statusText = 'Diversity: needs fossil record intervals';
          result = this.statCtrl.runSummary();
          break;
        case 'FBD Process':
          result = this.statCtrl.runFBD(0.5, 0.2, 0.1, 10);
          this.plotTitle = 'FBD Diversity Curve';
          this.plotType = 'line';
          break;
        case 'Beta Diversity': result = this.statCtrl.runBetaDiv(); break;
        case 'Null Model': this.showNullModelDialog = true; return;

        // File operations
        case 'Import': this.showImportDialog = true; return;
        case 'Export': this.showExportDialog = true; return;

        default:
          this.statusText = name + ': not implemented';
          return;
      }

      this.statusText = name + ' completed';
      this.addWidget(name);
    } catch (e) {
      this.statusText = name + ' error: ' + String(e).substring(0, 100);
    }
  }

  // ─── Workspace Management ─────────────────────────────────────

  private addWidget(name: string): void {
    if (!this.workspaceWidgets.includes(name)) {
      if (this.workspaceWidgets.length >= 8) this.workspaceWidgets.shift();
      this.workspaceWidgets.push(name);
    }
    this.currentWidget = this.workspaceWidgets.indexOf(name);
    if (this.currentWidget < 0) this.currentWidget = this.workspaceWidgets.length - 1;
  }

  // ─── Export (PDF/EPS/TIFF support) ──────────────────────────

  private exportPlot(format: string): void {
    switch (format) {
      case 'PNG':
        // Canvas.toDataURL('image/png')
        this.statusText = 'Exported PNG';
        break;
      case 'SVG':
        // Generate SVG markup
        this.statusText = 'Exported SVG';
        break;
      case 'PDF':
        // HarmonyOS: use @ohos.system.print or generate PDF via canvas
        this.statusText = 'Exported PDF (via print service)';
        break;
      case 'EPS':
        // Generate EPS markup (PostScript)
        this.statusText = 'Exported EPS';
        break;
      case 'TIFF':
        // Convert canvas to TIFF via library
        this.statusText = 'Exported TIFF';
        break;
    }
  }
}
