/**
 * IndVal (Indicator Value) — Dufrêne-Legendre 1997
 * Reference: Dufrêne, M. & Legendre, P. (1997). Species assemblages and
 *   indicator species: the need for a flexible asymmetrical approach.
 *   Ecological Monographs 67(3): 345–366.
 *
 * See also: labdsv::indval
 *
 * The IndVal index measures how characteristic a species is of a particular group:
 *   IndVal_ij = 100 * A_ij * B_ij
 * where:
 *   A_ij = specificity = (mean abundance of species j in group i) /
 *                         (sum of mean abundances of species j across all groups)
 *   B_ij = fidelity = (number of sites in group i where species j occurs) /
 *                     (total number of sites in group i)
 *
 * Statistical significance is assessed via permutation test (randomly shuffling
 * group memberships and recomputing IndVal).
 */

import { seed, rand } from '../../math/random';

/**
 * Indicator Value result for a single species-group pair.
 */
export interface IndValCell {
  indVal: number;       // IndVal_ij (0–100)
  specificity: number;   // A_ij
  fidelity: number;      // B_ij
  pValue: number;       // permutation p-value
  isSignificant: boolean;
}

/**
 * IndVal analysis result.
 */
export interface IndValResult {
  /**
   * IndVal matrix [species][group].
   * indval[speciesIdx][groupIdx] = IndVal_ij (0–100).
   */
  indval: number[][];
  /** Permutation p-values [species][group] */
  pvalues: number[][];
  /** Groups with significant indicator species (groupIdx -> speciesIdx[]) */
  significantByGroup: Map<number, number[]>;
  /** Indices of species that are significant indicators for at least one group */
  significantSpecies: number[];
  /** Species names */
  speciesNames: string[];
  /** Group labels */
  groupLabels: number[];
  /** Number of permutations used */
  nPermutations: number;
}

/**
 * Compute the Dufrêne-Legendre Indicator Value (IndVal) for species in groups.
 *
 * @param speciesAbundance  Matrix [site][species] of abundances (integers).
 *                         Rows = sites/samples, Columns = species.
 *                         Use 0 for absence.
 * @param groups           Array of group assignments for each site.
 *                         groups[siteIdx] = group label (integer, typically 1..G).
 * @param options          Options bag.
 * @param options.nPermutations  Number of permutations for p-value (default 999).
 * @param options.seed          Random seed (default 42).
 * @returns IndValResult with indval matrix, p-values, and significant species.
 *
 * @example
 * // Sites × Species abundance matrix
 * const abundance = [
 *   [10, 0, 5],  // site 1
 *   [8,  1, 3],  // site 2
 *   [0, 12, 2],  // site 3
 *   [0, 10, 1],  // site 4
 * ];
 * const groups = [1, 1, 2, 2]; // sites 1-2 belong to group 1, sites 3-4 to group 2
 * const result = indVal(abundance, groups);
 */
export function indVal(
  speciesAbundance: number[][],
  groups: number[],
  options?: { nPermutations?: number; seed?: number; speciesNames?: string[] },
): IndValResult {
  const nSites = speciesAbundance.length;
  const nSpecies = speciesAbundance[0]?.length ?? 0;
  const nPerm = options?.nPermutations ?? 999;
  const rngSeed = options?.seed ?? 42;

  if (nSites === 0 || nSpecies === 0) {
    return {
      indval: [],
      pvalues: [],
      significantByGroup: new Map(),
      significantSpecies: [],
      speciesNames: [],
      groupLabels: [],
      nPermutations: nPerm,
    };
  }

  // Unique group labels
  const groupSet = [...new Set(groups)].sort((a, b) => a - b);
  const G = groupSet.length;

  // Species names: caller-provided when available, else generic labels
  const speciesNames = options?.speciesNames && options.speciesNames.length >= nSpecies
    ? options.speciesNames.slice(0, nSpecies)
    : Array.from({ length: nSpecies }, (_, i) => `Species_${i + 1}`);

  // Step 1: Compute group sizes (number of sites per group)
  const groupSizes = new Map<number, number>();
  for (const g of groupSet) groupSizes.set(g, 0);
  for (const g of groups) groupSizes.set(g, (groupSizes.get(g) ?? 0) + 1);

  // Step 2: For each species j and group i, compute:
  //   A_ij = mean_abundance_in_group_i / sum_of_mean_abundances_across_groups
  //   B_ij = n_occurrences_in_group_i / n_sites_in_group_i
  const specificity: number[][] = Array.from({ length: nSpecies }, () => new Array(G).fill(0));
  const fidelity: number[][] = Array.from({ length: nSpecies }, () => new Array(G).fill(0));
  const meanAbundance: number[][] = Array.from({ length: nSpecies }, () => new Array(G).fill(0));

  for (let gi = 0; gi < G; gi++) {
    const g = groupSet[gi];
    const sitesInGroup: number[] = [];
    for (let s = 0; s < nSites; s++) if (groups[s] === g) sitesInGroup.push(s);

    for (let sp = 0; sp < nSpecies; sp++) {
      // Mean abundance in group i
      let sum = 0;
      let count = 0;
      for (const s of sitesInGroup) {
        sum += speciesAbundance[s][sp];
        if (speciesAbundance[s][sp] > 0) count++;
      }
      meanAbundance[sp][gi] = sitesInGroup.length > 0 ? sum / sitesInGroup.length : 0;
      fidelity[sp][gi] = sitesInGroup.length > 0 ? count / sitesInGroup.length : 0;
    }
  }

  // Sum of mean abundances across groups for each species
  const sumMeanAbund = new Array(nSpecies).fill(0);
  for (let sp = 0; sp < nSpecies; sp++) {
    for (let gi = 0; gi < G; gi++) sumMeanAbund[sp] += meanAbundance[sp][gi];
  }

  for (let sp = 0; sp < nSpecies; sp++) {
    for (let gi = 0; gi < G; gi++) {
      specificity[sp][gi] = sumMeanAbund[sp] > 0
        ? meanAbundance[sp][gi] / sumMeanAbund[sp]
        : 0;
    }
  }

  // Step 3: IndVal_ij = 100 * specificity * fidelity
  const indval: number[][] = Array.from({ length: nSpecies }, () => new Array(G).fill(0));
  for (let sp = 0; sp < nSpecies; sp++) {
    for (let gi = 0; gi < G; gi++) {
      indval[sp][gi] = 100 * specificity[sp][gi] * fidelity[sp][gi];
    }
  }

  // Step 4: Permutation test for each species-group pair
  // Null hypothesis: the species abundance is unrelated to group membership
  // For each permutation, shuffle site-group assignments and recompute IndVal
  const pvalues: number[][] = Array.from({ length: nSpecies }, () => new Array(G).fill(1));

  seed(rngSeed);

  for (let perm = 0; perm < nPerm; perm++) {
    // Randomly permute group assignments
    const shuffledGroups = [...groups];
    for (let i = shuffledGroups.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffledGroups[i], shuffledGroups[j]] = [shuffledGroups[j], shuffledGroups[i]];
    }

    // Recompute IndVal for this permutation
    const permSpec: number[][] = Array.from({ length: nSpecies }, () => new Array(G).fill(0));
    const permFidel: number[][] = Array.from({ length: nSpecies }, () => new Array(G).fill(0));
    const permMean: number[][] = Array.from({ length: nSpecies }, () => new Array(G).fill(0));

    for (let gi = 0; gi < G; gi++) {
      const g = groupSet[gi];
      const sitesInGroup: number[] = [];
      for (let s = 0; s < nSites; s++) if (shuffledGroups[s] === g) sitesInGroup.push(s);

      for (let sp = 0; sp < nSpecies; sp++) {
        let sum = 0, count = 0;
        for (const s of sitesInGroup) {
          sum += speciesAbundance[s][sp];
          if (speciesAbundance[s][sp] > 0) count++;
        }
        permMean[sp][gi] = sitesInGroup.length > 0 ? sum / sitesInGroup.length : 0;
        permFidel[sp][gi] = sitesInGroup.length > 0 ? count / sitesInGroup.length : 0;
      }
    }

    const permSumMean = new Array(nSpecies).fill(0);
    for (let sp = 0; sp < nSpecies; sp++)
      for (let gi = 0; gi < G; gi++) permSumMean[sp] += permMean[sp][gi];

    for (let sp = 0; sp < nSpecies; sp++) {
      for (let gi = 0; gi < G; gi++) {
        permSpec[sp][gi] = permSumMean[sp] > 0 ? permMean[sp][gi] / permSumMean[sp] : 0;
        const permIndVal = 100 * permSpec[sp][gi] * permFidel[sp][gi];
        // Count this permutation as extreme if >= observed
        if (permIndVal >= indval[sp][gi] - 1e-12) {
          pvalues[sp][gi] += 1;
        }
      }
    }
  }

  // Normalize p-values: (count + 1) / (nPerm + 1) avoids p=0
  for (let sp = 0; sp < nSpecies; sp++) {
    for (let gi = 0; gi < G; gi++) {
      pvalues[sp][gi] = Math.min(1, pvalues[sp][gi] / (nPerm + 1));
    }
  }

  // Step 5: Identify significant indicator species (p < 0.05)
  const significanceThreshold = 0.05;
  const significantSpeciesSet = new Set<number>();
  const significantByGroup = new Map<number, number[]>();

  for (const g of groupSet) {
    const gi = groupSet.indexOf(g);
    significantByGroup.set(g, []);
  }

  for (let sp = 0; sp < nSpecies; sp++) {
    let isSignificantAny = false;
    for (let gi = 0; gi < G; gi++) {
      const g = groupSet[gi];
      if (pvalues[sp][gi] < significanceThreshold) {
        significantSpeciesSet.add(sp);
        isSignificantAny = true;
        significantByGroup.get(g)!.push(sp);
      }
    }
  }

  return {
    indval,
    pvalues,
    significantByGroup,
    significantSpecies: [...significantSpeciesSet].sort((a, b) => a - b),
    speciesNames,
    groupLabels: groupSet,
    nPermutations: nPerm,
  };
}
