/**
 * DialogLayer — Dialog overlay container.
 * Replaces inline @Builder DialogLayer in Index.ets.
 * Mounts every analysis dialog in the project; each is conditionally rendered
 * when its boolean @Link is true. Every dialog binds visible via @Link so
 * Cancel/Run inside the dialog closes it through the parent state.
 */
@Component
export struct DialogLayer {
  @Link showImportDialog: boolean;
  @Link showExportDialog: boolean;
  @Link showPCADialog: boolean;
  @Link showPCoADialog: boolean;
  @Link showNMDSDialog: boolean;
  @Link showClusteringDialog: boolean;
  @Link showConissDialog: boolean;
  @Link showNullModelDialog: boolean;
  @Link showExtinctionDialog: boolean;
  @Link showEFADialog: boolean;
  // Extended wiring (2026-09 parity pass)
  @Link showUnivariateDialog: boolean;
  @Link showDiversityDialog: boolean;
  @Link showRarefactionDialog: boolean;
  @Link showSimperDialog: boolean;
  @Link showLDADialog: boolean;
  @Link showAnosimDialog: boolean;
  @Link showPermanovaDialog: boolean;
  @Link showCCADialog: boolean;
  @Link showGPADialog: boolean;
  @Link showAllometryDialog: boolean;
  @Link showEvoRateDialog: boolean;
  @Link showSpectralDialog: boolean;
  @Link showMarkovDialog: boolean;
  @Link showDirectionalDialog: boolean;
  @Link showIsotopeDialog: boolean;
  @Link showStratCorrDialog: boolean;
  @Link showBiostratDialog: boolean;
  @Link showPaleoEnvDialog: boolean;
  @Link showWaveletDialog: boolean;
  @Link showPICDialog: boolean;
  @Link showPhyloSignalDialog: boolean;
  @Link showPhyloAnovaDialog: boolean;
  @Link showBetaDivDialog: boolean;
  @Link showTPSDialog: boolean;

  onImportConfirm: (params: Record<string, Object>) => void = () => {};
  onExportConfirm: (params: Record<string, Object>) => void = () => {};
  onAnalysisConfirm: (name: string, params: Record<string, Object>) => void = () => {};
  onPCACancel: () => void = () => {};

  private transition(): TransitionEffect {
    return TransitionEffect.scale({ x: 0.9, y: 0.9 }).combine(TransitionEffect.OPACITY);
  }

  build() {
    Stack() {
      if (this.showImportDialog) {
        ImportDialog({ visible: $showImportDialog })
          .onConfirm((params: Record<string, Object>) => { this.onImportConfirm(params); })
          .transition(this.transition());
      }
      if (this.showExportDialog) {
        ExportDialog({ visible: $showExportDialog })
          .onConfirm((params: Record<string, Object>) => { this.onExportConfirm(params); })
          .transition(this.transition());
      }
      if (this.showPCADialog) {
        PCADialog({ visible: $showPCADialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('PCA', params); })
          .onCancel(() => { this.onPCACancel(); })
          .transition(this.transition());
      }
      if (this.showPCoADialog) {
        PCoADialog({ visible: $showPCoADialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('PCoA', params); })
          .transition(this.transition());
      }
      if (this.showNMDSDialog) {
        NMDSDialog({ visible: $showNMDSDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('NMDS', params); })
          .transition(this.transition());
      }
      if (this.showClusteringDialog) {
        ClusteringDialog({ visible: $showClusteringDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Clustering', params); })
          .transition(this.transition());
      }
      if (this.showConissDialog) {
        ConissDialog({ visible: $showConissDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('CONISS', params); })
          .transition(this.transition());
      }
      if (this.showNullModelDialog) {
        NullModelDialog({ visible: $showNullModelDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('NullModel', params); })
          .transition(this.transition());
      }
      if (this.showExtinctionDialog) {
        ExtinctionDialog({ visible: $showExtinctionDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Extinction', params); })
          .transition(this.transition());
      }
      if (this.showEFADialog) {
        EFADialog({ visible: $showEFADialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('EFA', params); })
          .transition(this.transition());
      }
      if (this.showUnivariateDialog) {
        UnivariateDialog({ visible: $showUnivariateDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Summary', params); })
          .transition(this.transition());
      }
      if (this.showDiversityDialog) {
        DiversityDialog({ visible: $showDiversityDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Diversity Indices', params); })
          .transition(this.transition());
      }
      if (this.showRarefactionDialog) {
        RarefactionDialog({ visible: $showRarefactionDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Rarefaction', params); })
          .transition(this.transition());
      }
      if (this.showSimperDialog) {
        SimperDialog({ visible: $showSimperDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('SIMPER', params); })
          .transition(this.transition());
      }
      if (this.showLDADialog) {
        LDADialog({ visible: $showLDADialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('LDA', params); })
          .transition(this.transition());
      }
      if (this.showAnosimDialog) {
        AnosimDialog({ visible: $showAnosimDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('ANOSIM', params); })
          .transition(this.transition());
      }
      if (this.showPermanovaDialog) {
        PermanovaDialog({ visible: $showPermanovaDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('PERMANOVA', params); })
          .transition(this.transition());
      }
      if (this.showCCADialog) {
        CCADialog({ visible: $showCCADialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('CCA', params); })
          .transition(this.transition());
      }
      if (this.showGPADialog) {
        GPADialog({ visible: $showGPADialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('GPA', params); })
          .transition(this.transition());
      }
      if (this.showAllometryDialog) {
        AllometryDialog({ visible: $showAllometryDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Allometry', params); })
          .transition(this.transition());
      }
      if (this.showEvoRateDialog) {
        EvoRateDialog({ visible: $showEvoRateDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Evolution Rate', params); })
          .transition(this.transition());
      }
      if (this.showSpectralDialog) {
        SpectralDialog({ visible: $showSpectralDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Spectral', params); })
          .transition(this.transition());
      }
      if (this.showMarkovDialog) {
        MarkovDialog({ visible: $showMarkovDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Markov', params); })
          .transition(this.transition());
      }
      if (this.showDirectionalDialog) {
        DirectionalDialog({ visible: $showDirectionalDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Directional', params); })
          .transition(this.transition());
      }
      if (this.showIsotopeDialog) {
        IsotopeDialog({ visible: $showIsotopeDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Isotope', params); })
          .transition(this.transition());
      }
      if (this.showStratCorrDialog) {
        StratCorrDialog({ visible: $showStratCorrDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Stratigraphic Correlation', params); })
          .transition(this.transition());
      }
      if (this.showBiostratDialog) {
        BiostratDialog({ visible: $showBiostratDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Biostratigraphy', params); })
          .transition(this.transition());
      }
      if (this.showPaleoEnvDialog) {
        PaleoEnvDialog({ visible: $showPaleoEnvDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Paleo-Environment', params); })
          .transition(this.transition());
      }
      if (this.showWaveletDialog) {
        WaveletDialog({ visible: $showWaveletDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Wavelet', params); })
          .transition(this.transition());
      }
      if (this.showPICDialog) {
        PICDialog({ visible: $showPICDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('PIC', params); })
          .transition(this.transition());
      }
      if (this.showPhyloSignalDialog) {
        PhyloSignalDialog({ visible: $showPhyloSignalDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Phylo Signal', params); })
          .transition(this.transition());
      }
      if (this.showPhyloAnovaDialog) {
        PhyloAnovaDialog({ visible: $showPhyloAnovaDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Phylo ANOVA', params); })
          .transition(this.transition());
      }
      if (this.showBetaDivDialog) {
        BetaDivDialog({ visible: $showBetaDivDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('Beta Diversity', params); })
          .transition(this.transition());
      }
      if (this.showTPSDialog) {
        TPSDialog({ visible: $showTPSDialog })
          .onConfirm((params: Record<string, Object>) => { this.onAnalysisConfirm('TPS Grid', params); })
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
