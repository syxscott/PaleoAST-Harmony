// Re-export everything from the consolidated phylogenetics module.
export * from './phylogenetics';
export { setupTipDating, type TipDateMap, type TipDatingResult } from './TipDating';
export {
  brownianVCV,
  blombergKFromVCV,
  simulateBrownianMotion,
  phyloBMLogLik,
  type BrownianVCVResult,
  type BMSimulationResult,
} from './vcv';
export {
  phylogeneticSignal,
  lambdaInterpretation,
  type PhylogeneticSignalResult,
} from './signal';
export { PhyloTree, DistanceMatrix } from './PhyloTree';
