import { Matrix } from '../math/Matrix';
import { StateManager } from '../data/index';
import { computeDistanceMatrix, Metric, pca, pcoa, nmds, lda, cca, anosim, permanova, simper, hierarchicalClustering, univariateSummary, tTest, anova, kruskalWallis, phylogeneticSignal } from '../analysis/statistics/index';
import { computeDiversity, computeRarefaction, betaDiversityDecomposition, nullModel, sheAnalysis, paleoEnvironment } from '../analysis/ecology/index';
import { coniss, markov, directional, extinctionCI, spectralAnalysis, isotopeAnalysis, waveletTransform, stratigraphicCorrelation } from '../analysis/stratigraphy/index';
import { cohortSurvivorship, estimateDiversity, simulateFBD } from '../analysis/macroevolution/index';
import { gpa, efa, allometry, evolutionRate, tpsDeformation, relativeWarps } from '../analysis/morphometrics/index';
import { parseNewick, fitchParsimony, pic, neighborJoining, PhyloNode } from '../analysis/phylogenetics/index';

/**
 * StatisticsController — orchestrates all analysis calls.
 * Replaces Python controllers/statistics_controller.py.
 */
export class StatisticsController {
  private state: StateManager = StateManager.getInstance();

  private getData(): Matrix {
    const dm = this.state.dataMatrix;
    if (!dm) throw new Error('No data loaded');
    return dm.data;
  }

  // Multivariate
  runPCA(nc?: number, method: string = 'covariance') { return pca(this.getData(), nc, method as any); }
  runPCoA(metric: string = 'bray_curtis', nc?: number) { return pcoa(computeDistanceMatrix(this.getData(), metric as Metric), nc); }
  runNMDS(metric = 'bray_curtis', nd = 2, maxIter?: number, nRestart?: number) { return nmds(computeDistanceMatrix(this.getData(), metric as Metric), nd, maxIter, nRestart); }
  runLDA(groups: number[], nc?: number) { return lda(this.getData(), groups, nc); }
  runCCA(Y: Matrix, X: Matrix, nc?: number, method = 'cca') { return cca(Y, X, nc, method as any); }
  runANOSIM(groups: number[], metric = 'bray_curtis', nPerm = 999) { return anosim(computeDistanceMatrix(this.getData(), metric as Metric), groups, nPerm); }
  runPERMANOVA(groups: number[], metric = 'bray_curtis', nPerm = 999) { return permanova(computeDistanceMatrix(this.getData(), metric as Metric), groups, nPerm); }
  runSIMPER(groups: number[], metric = 'bray_curtis') { return simper(this.getData(), groups); }
  runClustering(nc = 3, method = 'ward', metric = 'euclidean') { return hierarchicalClustering(this.getData(), method, metric, nc); }
  runSummary(colNames?: string[]) { return univariateSummary(this.getData(), colNames ?? []); }
  runTTest(g1: number[], g2: number[]) { return tTest(g1, g2); }
  runANOVA(groups: number[][]) { return anova(groups); }
  runKruskal(groups: number[][]) { return kruskalWallis(groups); }

  // Ecology
  runDiversity(abundances: number[], name?: string) { return computeDiversity(abundances, name); }
  runRarefaction(abundances: number[], maxN?: number, nPts?: number) { return computeRarefaction(abundances, maxN, nPts); }
  runBetaDiv(metric = 'jaccard') { const dm = this.state.dataMatrix; if (!dm) throw new Error('No data'); return betaDiversityDecomposition(dm.data.to2D(), metric as any); }
  runNullModel(metric = 'c_score', nPerm = 999) { const dm = this.state.dataMatrix; if (!dm) throw new Error('No data'); return nullModel(dm.data.to2D(), metric as any, nPerm); }
  runSHE() { const dm = this.state.dataMatrix; if (!dm) throw new Error('No data'); return sheAnalysis(dm.data.to2D(), dm.rowLabels); }
  runPaleoEnv(hc = 0) { const dm = this.state.dataMatrix; if (!dm) throw new Error('No data'); return paleoEnvironment(dm.data.to2D(), dm.data.col(hc)); }

  // Stratigraphy
  runCONISS(nz?: number) { return coniss(this.getData(), nz); }
  runMarkov() { return markov(this.getData().col(0).map(v => Math.round(v))); }
  runDirectional() { return directional(this.getData().col(0)); }
  runExtinctionCI(method = 'marshall', conf = 0.95) { return extinctionCI(this.getData().col(0), method as any, conf); }
  runSpectral() { return spectralAnalysis(this.getData().col(0)); }
  runIsotope(dc = 0, vc = 1) { const dm = this.state.dataMatrix; if (!dm) throw new Error('No data'); return isotopeAnalysis(dm.data.col(dc), dm.data.col(vc)); }
  runWavelet() { return waveletTransform(this.getData().col(0)); }
  runStratCorr(sections: { name: string; heights: number[]; values: number[] }[]) { return stratigraphicCorrelation(sections); }

  // Macroevolution
  runCohort(records: [number, number][], intervals: [number, number][]) { return cohortSurvivorship(records, intervals); }
  runDiversityDyn(records: [number, number][], intervals: [number, number][]) { return estimateDiversity(records, intervals); }
  runFBD(lambda: number, mu: number, psi: number, dur: number) { return simulateFBD(lambda, mu, psi, dur); }

  // Morphometrics
  runGPA() { return gpa(this.getData()); }
  runEFA(nh?: number, np?: number) { const dm = this.state.dataMatrix; if (!dm) throw new Error('No data'); const row = dm.data.row(0); const n = row.length / 2; const contour: number[][] = []; for (let i = 0; i < n; i++) contour.push([row[i], row[n + i]]); return efa(contour, nh); }
  runAllometry() { return allometry(this.getData()); }
  runEvoRate() { const dm = this.state.dataMatrix; if (!dm) throw new Error('No data'); return evolutionRate(dm.data.col(0), dm.data.col(1)); }
  runTPS(src: number[][], tgt: number[][], gs?: number) { return tpsDeformation(src, tgt, gs); }
  runRelativeWarps(nc?: number) { return relativeWarps(this.getData(), nc); }

  // Phylogenetics
  runFitch(tree: PhyloNode, seq: Record<string, string>) { return fitchParsimony(tree, seq); }
  runPIC(tree: PhyloNode, traits: Record<string, number>) { return pic(tree, traits); }
  runPhyloSignal(tree: PhyloNode, traits: Record<string, number>, np = 999) { return phylogeneticSignal(tree, traits, np); }
  runNJ(distMat: number[][], names: string[]) { return neighborJoining(distMat, names); }
  parseNewick(s: string) { return parseNewick(s); }

  // Cache
  cache(key: string, result: unknown) { this.state.cacheResult(key, result); }
  getCached<T>(key: string): T | null { return this.state.getCachedResult<T>(key); }
}
