import { Matrix } from '../math/Matrix';
import { DataMatrix, StateManager } from '../models/index';
import {
  computeDistanceMatrix, pca, pcoa, nmds, lda, cca, anosim, permanova, simper,
  hierarchicalClustering, univariateSummary, tTest, anova, kruskalWallis, phylogeneticSignal,
  mannWhitneyU, convexHullVolume, morphospaceDisparity, plsAnalysis, minimumSpanningTree,
  reconstructAncestralStates, ripleyK, normalityTest, phyloANOVA
} from '../analysis/statistics/index';
// `Metric` is a pure type alias. Importing it as a value binding makes the
// module graph fail to instantiate outside the hvigor/TS pipeline
// ("does not provide an export named 'Metric'"), which blocked the Node test
// harness from importing this controller at all.
import type { Metric } from '../analysis/statistics/index';
import {
  computeDiversity, computeRarefaction, betaDiversityDecomposition, nullModel, sheAnalysis,
  paleoEnvironment, fitAbundanceModels, fitLogSeries, lbKeogh, sampleBasedRarefaction,
  coverageRarefaction
} from '../analysis/ecology/index';
import {
  coniss, markov, directional, extinctionCI, spectralAnalysis, isotopeAnalysis, waveletTransform,
  stratigraphicCorrelation, lowessSmooth, fitPolynomialTrend, movingAverage, removeOutliers,
  crossValidate, detectExcursions, filterEndemic, buildARMAModel, armaPredict,
  unitaryAssociations, rasc, buildAgeModel, computeSedimentationRate, computeCorrelation
} from '../analysis/stratigraphy/index';
import {
  cohortSurvivorship, estimateDiversity, simulateFBD, coxPH, logRankTest, fitExponential,
  fitLogistic, simulateNeutral, fbdLogLikelihood, testEquilibrium, kaplanMeier
} from '../analysis/macroevolution/index';
import {
  gpa, efa, allometry, evolutionRate, tpsDeformation, relativeWarps,
  divideConfigurationIntoBlocks, eigenshape, plsIntegration, tpsAnalyze, tpsWarpGrid
} from '../analysis/morphometrics/index';
import {
  parseNewick, fitchParsimony, pic, neighborJoining, buildUPGMA, majorityRuleConsensus,
  heuristicSearch, strictConsensus, PhyloNode,
  phylogeneticSignal as phylogeneticSignalUnified, simulateBrownianMotion, computeRFDistance
} from '../analysis/phylogenetics/index';
import { tukeyHsd, cohensD, etaSquared, omegaSquared, partialEtaSquared, computeAicc, compareModels } from '../analysis/statistics/index';
import { chao1ConfidenceInterval, dtwDistanceMatrix } from '../analysis/ecology/index';
import {
  brokenStickTest, pyperPetermanCorrection, computePaleotemperatureErezLuz,
  computePaleotemperatureBemis, computePaleotemperatureKimONeil, blockBootstrapCI,
  armaCrossValidate, binForRose
} from '../analysis/stratigraphy/index';
import type { AiccModelSpec } from '../analysis/statistics/index';

/**
 * StatisticsController — orchestrates all analysis calls.
 * Replaces Python controllers/statistics_controller.py (1,179 lines).
 *
 * Each method:
 * 1. Retrieves data from StateManager
 * 2. Validates inputs
 * 3. Calls the analysis function
 * 4. Caches the result
 * 5. Returns the result
 */
export class StatisticsController {
  private state: StateManager = StateManager.getInstance();

  private getData(): Matrix {
    const dm = this.state.dataMatrix;
    if (!dm) throw new Error('No data loaded');
    return dm.data;
  }

  private getDM(): DataMatrix {
    const dm = this.state.dataMatrix;
    if (!dm) throw new Error('No data loaded');
    return dm;
  }

  // ─── Multivariate ──────────────────────────────────────────────

  runPCA(nc?: number, method: string = 'covariance') {
    const result = pca(this.getData(), nc, method as any);
    this.state.cacheResult('pca_result', result);
    return result;
  }

  runPCoA(metric: string = 'bray_curtis', nc?: number) {
    const D = computeDistanceMatrix(this.getData(), metric as Metric);
    const result = pcoa(D, nc);
    this.state.cacheResult('pcoa_result', result);
    return result;
  }

  runNMDS(metric = 'bray_curtis', nd = 2, maxIter?: number, nRestart?: number) {
    const D = computeDistanceMatrix(this.getData(), metric as Metric);
    const result = nmds(D, nd, maxIter, nRestart);
    this.state.cacheResult('nmds_result', result);
    return result;
  }

  runLDA(groups: number[], nc?: number) {
    const result = lda(this.getData(), groups, nc);
    this.state.cacheResult('lda_result', result);
    return result;
  }

  runCCA(Y: Matrix, X: Matrix, nc?: number, method = 'cca') {
    const result = cca(Y, X, nc, method as any);
    this.state.cacheResult('cca_result', result);
    return result;
  }

  runANOSIM(groups: number[], metric = 'bray_curtis', nPerm = 999) {
    const D = computeDistanceMatrix(this.getData(), metric as Metric);
    return anosim(D, groups, nPerm);
  }

  runPERMANOVA(groups: number[], metric = 'bray_curtis', nPerm = 999) {
    const D = computeDistanceMatrix(this.getData(), metric as Metric);
    return permanova(D, groups, nPerm);
  }

  runSIMPER(groups: number[], metric = 'bray_curtis') {
    return simper(this.getData(), groups);
  }

  runClustering(nc = 3, method = 'ward', metric = 'euclidean') {
    const result = hierarchicalClustering(this.getData(), method, metric, nc);
    this.state.cacheResult('clustering_result', result);
    return result;
  }

  runSummary(colNames?: string[]) {
    return univariateSummary(this.getData(), colNames ?? this.getDM().colLabels);
  }

  runTTest(g1: number[], g2: number[]) { return tTest(g1, g2); }
  runANOVA(groups: number[][]) { return anova(groups); }
  runKruskal(groups: number[][]) { return kruskalWallis(groups); }
  runMannWhitney(g1: number[], g2: number[]) { return mannWhitneyU(g1, g2); }
  runConvexHull(points: number[][]) { return convexHullVolume(points); }
  runMorphospaceDisparity() { return morphospaceDisparity(this.getData()); }
  runPLS(blockA: Matrix, blockB: Matrix, nc?: number) { return plsAnalysis(blockA, blockB, nc); }
  runMST(metric = 'euclidean') { return minimumSpanningTree(computeDistanceMatrix(this.getData(), metric as Metric)); }

  // ─── Ecology ───────────────────────────────────────────────────

  runDiversity(abundances: number[], name?: string) {
    const result = computeDiversity(abundances, name);
    this.state.cacheResult(`diversity_${name}`, result);
    return result;
  }

  runRarefaction(abundances: number[], maxN?: number, nPts?: number) {
    return computeRarefaction(abundances, maxN, nPts);
  }

  runSampleBasedRarefaction(nPts?: number) {
    const dm = this.getDM();
    return sampleBasedRarefaction(dm.data.to2D(), nPts);
  }

  runBetaDiv(metric = 'jaccard') {
    return betaDiversityDecomposition(this.getDM().data.to2D(), metric as any);
  }

  runNullModel(metric = 'c_score', nPerm = 999, nWorkers?: number) {
    return nullModel(this.getDM().data.to2D(), metric as any, nPerm);
  }

  runSHE() {
    const dm = this.getDM();
    return sheAnalysis(dm.data.to2D(), dm.rowLabels);
  }

  runPaleoEnv(hc = 0) {
    const dm = this.getDM();
    return paleoEnvironment(dm.data.to2D(), dm.data.col(hc));
  }

  runAbundanceModels() {
    return fitAbundanceModels(this.getData().row(0));
  }

  runLogSeries() {
    return fitLogSeries(this.getData().row(0));
  }

  // ─── Stratigraphy ──────────────────────────────────────────────

  runCONISS(nz?: number) {
    const result = coniss(this.getData(), nz);
    this.state.cacheResult('coniss_result', result);
    return result;
  }

  runMarkov() {
    return markov(this.getData().col(0).map(v => Math.round(v)));
  }

  runDirectional() {
    return directional(this.getData().col(0));
  }

  runExtinctionCI(method = 'marshall', conf = 0.95) {
    return extinctionCI(this.getData().col(0), method as any, conf);
  }

  runSpectral() {
    return spectralAnalysis(this.getData().col(0));
  }

  runIsotope(dc = 0, vc = 1) {
    const dm = this.getDM();
    return isotopeAnalysis(dm.data.col(dc), dm.data.col(vc));
  }

  runWavelet() {
    return waveletTransform(this.getData().col(0));
  }

  runStratCorr(sections: { name: string; heights: number[]; values: number[] }[]) {
    return stratigraphicCorrelation(sections);
  }

  runLowess(x: number[], y: number[], frac = 0.3) {
    return lowessSmooth(x, y, frac);
  }

  runPolynomialTrend(x: number[], y: number[], deg = 2) {
    return fitPolynomialTrend(x, y, deg);
  }

  runMovingAverage(data: number[], window = 5) {
    return movingAverage(data, window);
  }

  runRemoveOutliers(data: number[], method: 'iqr' | 'zscore' = 'iqr', threshold = 1.5) {
    return removeOutliers(data, method, threshold);
  }

  runCrossValidate(x: number[], y: number[], deg = 2) {
    return crossValidate(x, y, deg);
  }

  runDetectExcursions(depths: number[], values: number[], threshold = 2) {
    return detectExcursions(depths, values, threshold);
  }

  runFilterEndemic(matrix: number[][], minOcc = 1) {
    return filterEndemic(matrix, minOcc);
  }

  runBuildARMA(series: number[], p = 1, q = 0) {
    return buildARMAModel(series, p, q);
  }

  runARMAPredict(model: any, nSteps: number) {
    return armaPredict(model, nSteps);
  }

  // ─── Macroevolution ────────────────────────────────────────────

  runCohort(records: [number, number][], intervals: [number, number][]) {
    return cohortSurvivorship(records, intervals);
  }

  runDiversityDyn(records: [number, number][], intervals: [number, number][]) {
    return estimateDiversity(records, intervals);
  }

  runFBD(lambda: number, mu: number, psi: number, dur: number) {
    const result = simulateFBD(lambda, mu, psi, dur);
    this.state.cacheResult('fbd_result', result);
    return result;
  }

  runFBDLikelihood(lambda: number, mu: number, psi: number, treeData: any, rho = 1) {
    return fbdLogLikelihood(lambda, mu, psi, treeData, rho);
  }

  runCoxPH(durations: number[], events: number[], covariates: number[][]) {
    return coxPH(durations, events, covariates);
  }

  runLogRank(g1: { time: number; event: number }[], g2: { time: number; event: number }[]) {
    return logRankTest(g1, g2);
  }

  runFitExponential(times: number[], values: number[]) {
    return fitExponential(times, values);
  }

  runFitLogistic(times: number[], values: number[]) {
    return fitLogistic(times, values);
  }

  runSimulateNeutral(nTaxa: number, duration: number, specRate?: number, extRate?: number) {
    return simulateNeutral(nTaxa, duration, specRate, extRate);
  }

  runTestEquilibrium(origRate: number, extRate: number) {
    return testEquilibrium(origRate, extRate);
  }

  // ─── Morphometrics ─────────────────────────────────────────────

  runGPA() {
    const result = gpa(this.getData());
    this.state.cacheResult('gpa_result', result);
    return result;
  }

  runEFA(nh?: number, np?: number) {
    const dm = this.getDM();
    const row = dm.data.row(0);
    const n = row.length / 2;
    const contour: number[][] = [];
    for (let i = 0; i < n; i++) contour.push([row[i], row[n + i]]);
    const result = efa(contour, nh);
    this.state.cacheResult('efa_result', result);
    return result;
  }

  runAllometry() {
    const result = allometry(this.getData());
    this.state.cacheResult('allometry_result', result);
    return result;
  }

  runEvoRate() {
    const dm = this.getDM();
    return evolutionRate(dm.data.col(0), dm.data.col(1));
  }

  runTPS(src: number[][], tgt: number[][], gs?: number) {
    return tpsDeformation(src, tgt, gs);
  }

  runRelativeWarps(nc?: number) {
    return relativeWarps(this.getData(), nc);
  }

  runDivideBlocks(division: 'anterior_posterior' | 'random' = 'anterior_posterior', seed?: number) {
    return divideConfigurationIntoBlocks(this.getData(), division, seed);
  }

  // ─── Phylogenetics ─────────────────────────────────────────────

  runFitch(tree: PhyloNode, seq: Record<string, string>) {
    return fitchParsimony(tree, seq);
  }

  runPIC(tree: PhyloNode, traits: Record<string, number>) {
    return pic(tree, traits);
  }

  runPhyloSignal(tree: PhyloNode, traits: Record<string, number>, np = 999) {
    return phylogeneticSignal(tree, traits, np);
  }

  runPhyloANOVA(root: PhyloNode, traits: Record<string, number>, groups: Record<string, string>, np = 999) {
    return phyloANOVA(root, traits, groups, np);
  }

  runNJ(distMat: number[][], names: string[]) {
    return neighborJoining(distMat, names);
  }

  runUPGMA(distMat: number[][], names: string[]) {
    return buildUPGMA(distMat, names);
  }

  runMajorityRule(trees: PhyloNode[], threshold = 0.5) {
    return majorityRuleConsensus(trees, threshold);
  }

  runStrictConsensus(trees: PhyloNode[]) {
    return strictConsensus(trees);
  }

  runHeuristicSearch(sequences: Record<string, string>, nReplicates = 10, maxRearrangements = 1000) {
    return heuristicSearch(sequences, nReplicates, maxRearrangements);
  }

  parseNewick(s: string) {
    return parseNewick(s);
  }

  // ─── Cache & State ─────────────────────────────────────────────

  cache(key: string, result: unknown) { this.state.cacheResult(key, result); }
  getCached<T>(key: string): T | null { return this.state.getCachedResult<T>(key); }
  hasData(): boolean { return this.state.hasData; }
  getDataMatrix(): DataMatrix | null { return this.state.dataMatrix; }

  // ─── Newly ported analyses ───────────────────────────────────────────────

  runRipleyK(coords: number[][], rMax?: number, nR: number = 50, nSim: number = 99) {
    return ripleyK(coords, rMax, nR, nSim);
  }

  runNormalityTest(col: number = 0) {
    return normalityTest(this.getData(), col);
  }

  runCoverageRarefaction(coverageLevels?: number[], nIterations: number = 200) {
    const dm = this.getDM();
    return coverageRarefaction(dm.data.to2D(), coverageLevels, nIterations);
  }

  runKaplanMeier(times: number[], events: number[], confLevel: number = 0.95) {
    return kaplanMeier(times, events, confLevel);
  }

  runEigenshape(efaCoefficients: Matrix[] | number[][][], nComponents?: number) {
    return eigenshape(efaCoefficients, nComponents);
  }

  runPLSIntegration(blockA: Matrix, blockB: Matrix, nc?: number, nPerm: number = 999) {
    return plsIntegration(blockA, blockB, nc, nPerm);
  }

  runTPSAnalyze(source: number[][], target: number[][]) {
    return tpsAnalyze(source, target);
  }

  runTPSWarpGrid(result: { source: number[][]; warpPoints: (ps: number[][]) => number[][] }, rows: number = 20, cols: number = 20) {
    return tpsWarpGrid(result as any, rows, cols);
  }

  runUnitaryAssociations(fad: number[][], lad: number[][], sectionNames?: string[], eventNames?: string[]) {
    return unitaryAssociations(fad, lad, sectionNames, eventNames);
  }

  runRASC(distMatrix: number[][], eventNames?: string[], nIter: number = 100) {
    return rasc(distMatrix, eventNames, nIter);
  }

  runAgeModel(section: { name: string; heights: number[]; thicknesses?: number[]; lithologies?: string[]; ages?: number[]; ageErrors?: number[]; notes?: string[] }, constraints: [number, number, number][], modelType: 'linear' | 'spline' = 'linear') {
    return buildAgeModel(section as any, constraints, modelType);
  }

  runSedimentationRate(section: { name: string; heights: number[]; thicknesses?: number[]; lithologies?: string[]; ages?: number[]; ageErrors?: number[]; notes?: string[] }, smooth: boolean = true) {
    return computeSedimentationRate(section as any, smooth);
  }

  runComputeCorrelation(x: number[], y: number[], method: 'pearson' | 'spearman' = 'pearson') {
    return computeCorrelation(x, y, method);
  }

  // ─── Newly ported functions (2026-09 parity pass) ───────────────

  runTukeyHSD(groups: number[][]) {
    return tukeyHsd(groups);
  }

  runPairedTTest(before: number[], after: number[]) {
    return tTest(before, after, true);
  }

  /**
   * Effect sizes for a two-group comparison.
   *
   * The previous implementation returned the FUNCTIONS `etaSquared`,
   * `omegaSquared` and `partialEtaSquared` rather than calling them, so callers
   * received function objects where they expected numbers. An F test on the two
   * groups gives the df pair these estimators need (and is equivalent to the
   * two-sample t test).
   */
  runEffectSizes(group1: number[], group2: number[]) {
    const a = group1.filter(v => isFinite(v));
    const b = group2.filter(v => isFinite(v));
    const result: Record<string, number> = { cohensD: cohensD(a, b) };
    const n1 = a.length, n2 = b.length;
    if (n1 < 2 || n2 < 2) return result;

    const r = anova([a, b], false);
    const f = r.fStatistic;
    const dfBetween = r.dfBetween;
    const dfWithin = r.dfWithin;
    if (!isFinite(f) || dfBetween <= 0 || dfWithin <= 0) return result;

    result['etaSquared'] = etaSquared(f, dfBetween, dfWithin);
    result['partialEtaSquared'] = partialEtaSquared(f, dfBetween, dfWithin);
    if (n1 + n2 > dfBetween) {
      result['omegaSquared'] = omegaSquared(f, dfBetween, dfWithin, n1 + n2);
    }
    return result;
  }

  runAICc(logLik: number, nParams: number, nObs: number) {
    return computeAicc(logLik, nParams, nObs);
  }

  runModelComparison(models: { name: string; logLik: number; nParams: number; nObs: number }[]) {
    const specs: AiccModelSpec[] = models.map(m => ({
      name: m.name, logLik: m.logLik, nParams: m.nParams, nObs: m.nObs,
    }));
    return compareModels(specs);
  }

  /** Unified phylogenetic signal: canonical Blomberg K + Pagel λ (signal.py). */
  runPhylogeneticSignalUnified(tree: PhyloNode, traitData: Record<string, number>, nPermutations = 999) {
    const tips = tree.getLeaves();
    const values = tips.map(t => traitData[t.name] ?? 0);
    return phylogeneticSignalUnified(tree, values, nPermutations);
  }

  /** Simulate a Brownian-motion trait on the tree (signal.py). */
  runSimulateBrownianMotion(tree: PhyloNode, rootValue = 0, sigma = 0.1, seed?: number) {
    return simulateBrownianMotion(tree, rootValue, sigma, seed);
  }

  /** Robinson-Foulds distance between two trees. */
  runRFDistance(tree1: PhyloNode, tree2: PhyloNode) {
    return computeRFDistance(tree1, tree2);
  }

  /** Ancestral state reconstruction (pcm.py reconstruct_ancestral_states). */
  runAncestralStates(model: string = 'bm') {
    const result = reconstructAncestralStates(this.runGetRootTree(), this._numericColumn(0), model);
    this.state.cacheResult('asr_result', result);
    return result;
  }

  private runGetRootTree(): PhyloNode {
    const cached = this.state.getCachedResult<{ tree: PhyloNode }>('parsed_tree');
    if (cached?.tree) return cached.tree;
    throw new Error('No tree parsed. Import a Newick tree first.');
  }

  private _numericColumn(colIdx: number): Record<string, number> {
    const dm = this.getDM();
    const out: Record<string, number> = {};
    for (let i = 0; i < Math.min(dm.nSamples, dm.rowLabels.length); i++) {
      out[dm.rowLabels[i]] = dm.data.get(i, colIdx);
    }
    return out;
  }

  /** Chao1 estimate + log-transformed CI (diversity.py). */
  runChao1CI(row: number, confidenceLevel = 0.95) {
    return chao1ConfidenceInterval(this.getData().row(row), confidenceLevel);
  }

  /** Paleotemperature from δ18O (isotope_analysis.py: erez_luz/bemis/kim_oneil). */
  runPaleotemperature(delta18OSw: number, delta18Oc: number, formula: 'erez_luz' | 'bemis' | 'kim_oneil' = 'kim_oneil', genus = 'generic') {
    if (formula === 'erez_luz') return { temperatureC: computePaleotemperatureErezLuz(delta18OSw, delta18Oc) };
    if (formula === 'bemis') return { temperatureC: computePaleotemperatureBemis(delta18Oc, genus) };
    return { temperatureC: computePaleotemperatureKimONeil(delta18OSw, delta18Oc) };
  }

  /** Broken-stick significance for CONISS zones (coniss.py). */
  runBrokenStick(row?: number, nPermutations = 999) {
    void row;
    const c = this.runCONISS(4);
    const bd = (c as { linkageMatrix?: number[][] }).linkageMatrix?.map(r => r[2]) ?? [];
    return brokenStickTest(bd, nPermutations);
  }

  /** Pyper-Peterman autocorrelation-corrected correlation (correlation.py). */
  runPyperPeterman(x: number[], y: number[]) {
    return pyperPetermanCorrection(x, y);
  }

  /** Block-bootstrap CI of the mean (isotope_analysis.py). */
  runBlockBootstrap(data: number[], blockSize?: number, nBootstrap = 1000) {
    return blockBootstrapCI(data, (s) => s.reduce((a, b) => a + b, 0) / s.length, blockSize, nBootstrap);
  }

  /** ARIMA order selection by AIC/BIC grid (arma.py cross_validate). */
  runArmaCrossValidate(maxP = 2, maxQ = 1, d = 0) {
    const dm = this.getDM();
    const series = dm.data.col(0);
    return armaCrossValidate(series, series, maxP, maxQ, d);
  }

  /** Pairwise DTW distance matrix (dtw.py). */
  runDTWDistanceMatrix() {
    const dm = this.getDM();
    const rows: number[][] = [];
    for (let i = 0; i < dm.nSamples; i++) rows.push(dm.data.row(i));
    return dtwDistanceMatrix(rows);
  }

  /** Rose-diagram binning (directional.py bin_for_rose). */
  runBinRose(angles: number[], nBins = 12) {
    return binForRose(angles, nBins);
  }
}
