/**
 * DialogLayer — tag-based dialog host (ohos_smart_dialog pattern).
 *
 * A single AppStorage slot (`activeDialog`) names the open dialog; DialogLayer
 * renders it by name and feeds it a shared `dialogVisible` link so Cancel/Run
 * inside the dialog closes it. Params travel via DialogManager.getParams().
 *
 * Adding a new dialog = one import + one if-branch here. Nothing else changes.
 */
@Component
export struct DialogLayer {
  @StorageLink('activeDialog') @Watch('onActiveChanged') activeDialog: string = '';
  @State @Watch('onVisibleChanged') dialogVisible: boolean = false;

  onImportConfirm: (params: Record<string, Object>) => void = () => {};
  onExportConfirm: (params: Record<string, Object>) => void = () => {};
  onAnalysisConfirm: (name: string, params: Record<string, Object>) => void = () => {};

  private transition(): TransitionEffect {
    return TransitionEffect.scale({ x: 0.9, y: 0.9 }).combine(TransitionEffect.OPACITY);
  }

  onActiveChanged(): void {
    this.dialogVisible = this.activeDialog.length > 0;
  }

  /** Dialog set visible=false (Cancel/Run) → clear the registry slot. */
  onVisibleChanged(): void {
    if (!this.dialogVisible && this.activeDialog.length > 0) {
      DialogManager.dismiss();
    }
  }

  private analysis(name: string): (params: Record<string, Object>) => void {
    return (params: Record<string, Object>) => { this.onAnalysisConfirm(name, params); };
  }

  build() {
    Stack() {
      if (this.dialogVisible && this.activeDialog === 'Import') {
        ImportDialog({ visible: $dialogVisible })
          .onConfirm((params: Record<string, Object>) => { this.onImportConfirm(params); })
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Export') {
        ExportDialog({ visible: $dialogVisible })
          .onConfirm((params: Record<string, Object>) => { this.onExportConfirm(params); })
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'PCA') {
        PCADialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('PCA'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'PCoA') {
        PCoADialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('PCoA'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'NMDS') {
        NMDSDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('NMDS'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Clustering') {
        ClusteringDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Clustering'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'CONISS') {
        ConissDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('CONISS'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'NullModel') {
        NullModelDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('NullModel'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Extinction') {
        ExtinctionDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Extinction'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'EFA') {
        EFADialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('EFA'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Univariate') {
        UnivariateDialog({ visible: $dialogVisible })
          // Must dispatch on the dialog's own name: hard-writing 'Summary' here
          // discarded the selected test (Normality / t-test / ANOVA /
          // Kruskal-Wallis) and always produced the descriptive summary.
          .onConfirm(this.analysis('Univariate'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Diversity Indices') {
        DiversityDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Diversity Indices'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Rarefaction') {
        RarefactionDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Rarefaction'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'SIMPER') {
        SimperDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('SIMPER'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'LDA') {
        LDADialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('LDA'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'ANOSIM') {
        AnosimDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('ANOSIM'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'PERMANOVA') {
        PermanovaDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('PERMANOVA'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'CCA') {
        CCADialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('CCA'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'GPA') {
        GPADialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('GPA'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Allometry') {
        AllometryDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Allometry'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Evolution Rate') {
        EvoRateDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Evolution Rate'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Spectral') {
        SpectralDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Spectral'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Markov') {
        MarkovDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Markov'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Directional') {
        DirectionalDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Directional'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Isotope') {
        IsotopeDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Isotope'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Stratigraphic Correlation') {
        StratCorrDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Stratigraphic Correlation'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Biostratigraphy') {
        BiostratDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Biostratigraphy'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Paleo-Environment') {
        PaleoEnvDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Paleo-Environment'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Wavelet') {
        WaveletDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Wavelet'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'PIC') {
        PICDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('PIC'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Phylo Signal') {
        PhyloSignalDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Phylo Signal'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Phylo ANOVA') {
        PhyloAnovaDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Phylo ANOVA'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'Beta Diversity') {
        BetaDivDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('Beta Diversity'))
          .transition(this.transition());
      }
      if (this.dialogVisible && this.activeDialog === 'TPS Grid') {
        TPSDialog({ visible: $dialogVisible })
          .onConfirm(this.analysis('TPS Grid'))
          .transition(this.transition());
      }
    }
    .width('100%')
    .height('100%');
  }
}

// Dialog imports
import { PCADialog } from './dialogs/PCADialog';
import { PCoADialog } from './dialogs/PCoADialog';
import { NMDSDialog } from './dialogs/NMDSDialog';
import { ClusteringDialog } from './dialogs/ClusteringDialog';
import { ConissDialog } from './dialogs/ConissDialog';
import { NullModelDialog } from './dialogs/NullModelDialog';
import { ExtinctionDialog } from './dialogs/ExtinctionDialog';
import { EFADialog } from './dialogs/EFADialog';
import { ImportDialog } from './dialogs/ImportDialog';
import { ExportDialog } from './dialogs/ExportDialog';
import { UnivariateDialog } from './dialogs/UnivariateDialog';
import { DiversityDialog } from './dialogs/DiversityDialog';
import { RarefactionDialog } from './dialogs/RarefactionDialog';
import { SimperDialog } from './dialogs/SimperDialog';
import { LDADialog } from './dialogs/LDADialog';
import { AnosimDialog } from './dialogs/AnosimDialog';
import { PermanovaDialog } from './dialogs/PermanovaDialog';
import { CCADialog } from './dialogs/CCADialog';
import { GPADialog } from './dialogs/GPADialog';
import { AllometryDialog } from './dialogs/AllometryDialog';
import { EvoRateDialog } from './dialogs/EvoRateDialog';
import { SpectralDialog } from './dialogs/SpectralDialog';
import { MarkovDialog } from './dialogs/MarkovDialog';
import { DirectionalDialog } from './dialogs/DirectionalDialog';
import { IsotopeDialog } from './dialogs/IsotopeDialog';
import { StratCorrDialog } from './dialogs/StratCorrDialog';
import { BiostratDialog } from './dialogs/BiostratDialog';
import { PaleoEnvDialog } from './dialogs/PaleoEnvDialog';
import { WaveletDialog } from './dialogs/WaveletDialog';
import { PICDialog } from './dialogs/PICDialog';
import { PhyloSignalDialog } from './dialogs/PhyloSignalDialog';
import { PhyloAnovaDialog } from './dialogs/PhyloAnovaDialog';
import { BetaDivDialog } from './dialogs/BetaDivDialog';
import { TPSDialog } from './dialogs/TPSDialog';
import { DialogManager } from './DialogManager';
