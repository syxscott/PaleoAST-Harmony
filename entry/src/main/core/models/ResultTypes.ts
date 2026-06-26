/**
 * Result type definitions for all analysis modules.
 */
import { Matrix } from '../math/Matrix';

export interface PCAResult { scores: Matrix; loadings: Matrix; eigenvalues: number[]; explainedVariance: number[]; cumulativeVariance: number[]; eigenvaluesRaw: number[]; meanVector: number[]; nComponents: number; method: string; }
export interface PCoAResult { coordinates: Matrix; eigenvalues: number[]; proportionExplained: number[]; cumulativeProportion: number[]; nComponents: number; }
export interface NMDSResult { coordinates: Matrix; stress: number; nIterations: number; converged: boolean; }
export interface LDAResult { scores: Matrix; loadings: Matrix; explainedVarianceRatio: number[]; eigenvalues: number[]; confusionMatrix: number[][]; accuracy: number; nClasses: number; nSamples: number; classLabels: number[]; means: Matrix; groups: number[]; }
export interface CCAResult { siteScores: Matrix; speciesScores: Matrix; biplotScores: Matrix; eigenvalues: number[]; proportionExplained: number[]; cumulativeProportion: number[]; constrainedVariance: number; method: string; nComponents: number; }
export interface ANOSIMResult { statistic: number; pValue: number; nPermutations: number; }
export interface PERMANOVAResult { fStatistic: number; pValue: number; ssBetween: number; ssWithin: number; dfBetween: number; dfWithin: number; nPermutations: number; }
export interface SIMPERResult { overallDissimilarity: number; contributions: { name: string; index: number; average: number; std: number; cumulative: number; ratio: number }[]; }
export interface TTestResult { statistic: number; pValue: number; df: number; meanDiff: number; }
export interface ANOVAResult { fStatistic: number; pValue: number; dfBetween: number; dfWithin: number; ssBetween: number; ssWithin: number; }
export interface KruskalResult { statistic: number; pValue: number; df: number; }
export interface ClusteringResult { linkageMatrix: number[][]; copheneticCorr: number; labels: number[]; nClusters: number; method: string; metric: string; }
export interface ColumnStats { name: string; n: number; mean: number; std: number; variance: number; min: number; max: number; median: number; skewness: number; kurtosis: number; se: number; ci95: [number, number]; }
export interface DiversityResult { sampleName: string; richness: number; shannon: number; simpson: number; pielou: number; margalef: number; evenness: number; totalIndividuals: number; abundances: Record<string, number>; }
export interface RarefactionResult { sampleName: string; sampleSizes: number[]; expectedTaxa: number[]; }
export interface PhyloSignalResult { k: number; z: number; pValue: number; nRandomizations: number; }
export interface PhyloANOVAResult { fStatistic: number; pValue: number; ssBetween: number; ssWithin: number; nPermutations: number; }
export interface MannWhitneyResult { uStatistic: number; pValue: number; zScore: number; }
export interface DisparityResult { meanSquaredDistance: number; variance: number; ranges: number[]; nSpecimens: number; }
export interface PLSResult { xScores: Matrix; yScores: Matrix; singularValues: number[]; covarianceExplained: number[]; rvCoefficient: number; nComponents: number; }
export interface MSTResult { edges: [number, number, number][]; totalWeight: number; nEdges: number; }
export interface ASRResult { nodeStates: Map<string, number>; nodeNames: string[]; tipValues: Record<string, number>; model: string; }
