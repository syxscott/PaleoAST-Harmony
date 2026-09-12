// =============================================================================
// FILE: statistics/Univariate.ts
// =============================================================================
/**
 * AICc model selection and effect size measures.
 *
 * Ported from Python statistics/univariate.py:
 *   - compute_aicc / compare_models   (AICc + AICc weights)
 *   - cohens_d                        (pooled-SD standardized mean difference)
 *   - eta_squared / omega_squared / partial_eta_squared (ANOVA effect sizes)
 *
 * References:
 * - Burnham, K. P., & Anderson, D. R. (2002). Model Selection and Multimodel
 *   Inference: A Practical Information-Theoretic Approach (2nd ed.). Springer.
 * - Cohen, J. (1988). Statistical Power Analysis for the Behavioral Sciences
 *   (2nd ed.). Lawrence Erlbaum Associates.
 * - Cohen, J. (1992). A power primer. Psychological Bulletin, 112(1), 155-159.
 * - Lakens, D. (2013). Calculating and reporting effect sizes to facilitate
 *   cumulative science. Frontiers in Psychology, 4, 863.
 */

// ═══════════════════════════════════════════════════════════════════
// AICc Model Selection (Burnham & Anderson 2002)
// ═══════════════════════════════════════════════════════════════════

/**
 * Small-sample corrected Akaike Information Criterion (AICc).
 *
 * Formula (Burnham & Anderson 2002, eq. 2.2.2):
 *     AIC  = -2 * LL + 2 * k
 *     AICc = AIC + (2 * k * (k + 1)) / (n - k - 1)
 *
 * @param logLik  log-likelihood of the fitted model
 * @param nParams number of estimated parameters (k)
 * @param nObs    number of observations (n)
 * @throws Error when n - k - 1 <= 0 (insufficient data for the correction).
 */
export function computeAicc(logLik: number, nParams: number, nObs: number): number {
  if (nParams <= 0) throw new Error('n_params must be a positive integer');
  if (nObs <= 0) throw new Error('n_obs must be a positive integer');
  if (nParams >= nObs) {
    throw new Error(`n_params (${nParams}) must be less than n_obs (${nObs}) for AICc computation`);
  }
  if (nObs - nParams - 1 <= 0) {
    throw new Error(`Insufficient data for AICc correction: n (${nObs}) - k (${nParams}) - 1 must be > 0`);
  }
  const k = nParams, n = nObs;
  const aic = -2.0 * logLik + 2.0 * k;
  const correction = (2.0 * k * (k + 1.0)) / (n - k - 1.0);
  return aic + correction;
}

/** Candidate model spec for compareModels: [name, logLik, nParams, nObs]. */
export interface AiccModelSpec {
  name: string;
  logLik: number;
  nParams: number;
  nObs: number;
}

/** Per-model AICc comparison row (mirrors the dicts of Python compare_models). */
export interface AiccModelResult {
  name: string;
  aicc: number;
  logLik: number;
  nParams: number;
  nObs: number;
  /** AICc difference relative to the best model. */
  deltaAicc: number;
  /** AICc weight w_i (sums to 1 over the candidate set). */
  weight: number;
}

/** Result of compareModels. */
export interface AiccComparison {
  /** Candidate models sorted by AICc ascending (best first). */
  models: AiccModelResult[];
  /** Name of the best (lowest AICc) model. */
  bestModel: string;
  deltaAicc: number[];
  weights: number[];
}

/**
 * Compare candidate models via AICc and compute Akaike weights.
 *
 * Weight for model i: w_i = exp(-0.5 * dAICc_i) / Sum_j exp(-0.5 * dAICc_j).
 * Weights represent the relative probability that model i is the best in
 * the candidate set given the data (Burnham & Anderson 2002).
 */
export function compareModels(models: AiccModelSpec[]): AiccComparison {
  if (models.length === 0) throw new Error('models list cannot be empty');

  const results: AiccModelResult[] = models.map(m => {
    let aicc: number;
    try {
      aicc = computeAicc(m.logLik, m.nParams, m.nObs);
    } catch (e) {
      throw new Error(`Model '${m.name}' has insufficient data for AICc (nParams=${m.nParams}, nObs=${m.nObs})`);
    }
    return {
      name: m.name, aicc, logLik: m.logLik, nParams: m.nParams, nObs: m.nObs,
      deltaAicc: 0, weight: 0,
    };
  });

  // Sort by AICc ascending
  results.sort((a, b) => a.aicc - b.aicc);
  const bestAicc = results[0].aicc;
  const deltaAicc = results.map(r => r.aicc - bestAicc);

  // Weights (max-shift for numerical stability)
  const logWeights = deltaAicc.map(d => -0.5 * d);
  const maxLogW = Math.max(...logWeights);
  let raw = logWeights.map(lw => Math.exp(lw - maxLogW));
  const sumW = raw.reduce((s, w) => s + w, 0);
  const weights = raw.map(w => w / sumW);

  results.forEach((r, i) => { r.deltaAicc = deltaAicc[i]; r.weight = weights[i]; });

  return { models: results, bestModel: results[0].name, deltaAicc, weights };
}

// ═══════════════════════════════════════════════════════════════════
// Effect Size Measures (Cohen 1988, Cohen 1992, Lakens 2013)
// ═══════════════════════════════════════════════════════════════════

/** Mean of a numeric array (NaN-filtered by the callers). */
function meanOf(a: number[]): number {
  let s = 0; for (const v of a) s += v;
  return s / a.length;
}

/** Unbiased (ddof=1) sample variance. */
function varOf(a: number[]): number {
  const m = meanOf(a);
  let ss = 0; for (const v of a) ss += (v - m) ** 2;
  return ss / (a.length - 1);
}

/**
 * Cohen's d for the difference between two independent groups
 * (Cohen 1988 eq. 3.6, pooled-SD formulation):
 *
 *     d = (mean_1 - mean_2) / s_pooled
 *     s_pooled = sqrt(((n1-1)s1^2 + (n2-1)s2^2) / (n1 + n2 - 2))
 *
 * NaN values are removed before computing. Interpretation (Cohen 1988):
 * |d| ~ 0.2 small, ~0.5 medium, ~0.8 large.
 *
 * @throws Error if either group has fewer than 2 valid observations or the
 *          pooled SD is zero.
 */
export function cohensD(group1: number[], group2: number[]): number {
  const g1 = group1.filter(v => !isNaN(v));
  const g2 = group2.filter(v => !isNaN(v));
  const n1 = g1.length, n2 = g2.length;
  if (n1 < 2) throw new Error(`group1 must have at least 2 valid observations, got ${n1}`);
  if (n2 < 2) throw new Error(`group2 must have at least 2 valid observations, got ${n2}`);

  const mean1 = meanOf(g1), mean2 = meanOf(g2);
  const var1 = varOf(g1), var2 = varOf(g2);
  const sPooled = Math.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2));
  if (sPooled === 0) throw new Error('Pooled standard deviation is zero (all values identical)');
  return (mean1 - mean2) / sPooled;
}

/**
 * Eta-squared from ANOVA results (Cohen 1988 eq. 8.2.3):
 *     eta^2 = (F * df_between) / (F * df_between + df_within)
 * Interpretation: ~0.01 small, ~0.06 medium, ~0.14 large. Biased upward
 * for small samples; prefer omegaSquared for population estimates.
 */
export function etaSquared(fStatistic: number, dfBetween: number, dfWithin: number): number {
  if (dfBetween <= 0) throw new Error('df_between must be a positive integer');
  if (dfWithin < 0) throw new Error('df_within must be a non-negative integer');
  const numerator = fStatistic * dfBetween;
  const denominator = numerator + dfWithin;
  if (denominator === 0) return 0;
  const eta2 = numerator / denominator;
  return Math.min(1, Math.max(0, eta2));
}

/**
 * Omega-squared from ANOVA results (Cohen 1988 eq. 8.2.4; Lakens 2013):
 *     omega^2 = (F*df_between - df_between) / (F*df_between + df_within + 1)
 * Less biased than eta^2, especially for small samples.
 */
export function omegaSquared(fStatistic: number, dfBetween: number, dfWithin: number, n: number): number {
  if (dfBetween <= 0) throw new Error('df_between must be a positive integer');
  if (dfWithin < 0) throw new Error('df_within must be a non-negative integer');
  if (n <= dfBetween) throw new Error(`Total observations n (${n}) must exceed df_between (${dfBetween})`);
  const numerator = fStatistic * dfBetween - dfBetween;
  const denominator = fStatistic * dfBetween + dfWithin + 1.0;
  if (denominator === 0) return 0;
  const omega2 = numerator / denominator;
  return Math.min(1, Math.max(0, omega2));
}

/**
 * Partial eta-squared from ANOVA/ANCOVA results (Cohen 1992):
 *     eta^2_p = (F * df_between) / (F * df_between + df_error)
 * Equivalent to etaSquared for a single factor; conceptually preferred
 * with multiple factors or covariates.
 */
export function partialEtaSquared(fStatistic: number, dfBetween: number, dfError: number): number {
  if (dfBetween <= 0) throw new Error('df_between must be a positive integer');
  if (dfError < 0) throw new Error('df_error must be a non-negative integer');
  const numerator = fStatistic * dfBetween;
  const denominator = numerator + dfError;
  if (denominator === 0) return 0;
  const eta2p = numerator / denominator;
  return Math.min(1, Math.max(0, eta2p));
}
