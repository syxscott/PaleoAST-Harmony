/**
 * Diversity result containers — replaces models/diversity_result.py.
 *
 * These wrap diversity index data computed by ecology/diversity.py
 * and ecology/rarefaction.py into structured response objects.
 */

/** Single-sample diversity indices. */
export interface DiversityIndexResult {
  sampleName: string;
  richness: number;
  shannon: number;
  simpson: number;
  pielou: number;
  margalef: number;
  evenness: number;
  totalIndividuals: number;
  fisherAlpha?: number;
  chao1?: number;
  abundances: Record<string, number>;
}

/** Aggregated diversity result over multiple samples. */
export interface DiversityResult {
  samples: DiversityIndexResult[];
  meanShannon: number;
  meanSimpson: number;
  meanRichness: number;
  totalRichness: number;
  nSamples: number;
}

/** Sample-based rarefaction result. */
export interface RarefactionResult {
  sampleName: string;
  sampleSizes: number[];
  expectedTaxa: number[];
  confidenceLower?: number[];
  confidenceUpper?: number[];
}
