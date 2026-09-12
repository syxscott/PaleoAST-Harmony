/**
 * Phylogenetic signal — port of phylogenetics/signal.py (canonical versions).
 *
 * - phylogeneticSignal: unified Blomberg K + Pagel λ entry point with
 *   permutation p-values (add-one corrected).
 * - pagelLambda: bounded optimisation of λ on the standard (ape-convention)
 *   VCV with GLS mean-centering and profiled σ², plus boundary-corrected
 *   likelihood-ratio p-values (Self & Liang 1987: 0.5·χ²₁ mixture at the
 *   λ=0 boundary).
 */
import { PhyloNode } from './phylogenetics';
import { brownianVCV, blombergKFromVCV, phyloBMLogLik } from './vcv';
import { seed as seedRng, shuffle } from '../../math/random';
import { pchisq } from '../../math/stats';

export { simulateBrownianMotion } from './vcv';

export interface PhylogeneticSignalResult {
  K: number;
  kPValue: number;
  lambda: number;
  lambdaPValue: number;
  logLik: number;
  logLikLambda0: number;
  logLikLambda1: number;
  nTaxa: number;
  tipNames: string[];
  /** Interpretation text for λ (signal.py lambda_interpretation). */
  lambdaInterpretation: string;
}

/**
 * Compute both Blomberg's K (with permutation test) and Pagel's λ (with
 * boundary-corrected LRT) for a continuous trait on a rooted tree.
 */
export function phylogeneticSignal(
  tree: PhyloNode,
  traitValues: number[],
  nRandomizations: number = 999,
  rngSeed?: number,
): PhylogeneticSignalResult {
  const { tipNames, V } = brownianVCV(tree, 1.0);
  const n = Math.min(tipNames.length, traitValues.length);
  const y = traitValues.slice(0, n);

  if (rngSeed !== undefined) seedRng(rngSeed);

  const K = blombergKFromVCV(y, V);
  const permKs: number[] = [];
  for (let i = 0; i < nRandomizations; i++) {
    const permuted = shuffle([...y]);
    permKs.push(blombergKFromVCV(permuted, V));
  }
  const kPValue = (permKs.filter(k => k >= K).length + 1) / (nRandomizations + 1);

  // λ optimisation: coarse grid + golden-section refinement on [0, 1]
  const logLikAt = (lam: number): number => phyloBMLogLik(brownianVCV(tree, lam).V, y);
  let bestLam = 1.0, bestLL = logLikAt(1.0);
  for (let lam = 0; lam <= 1.0001; lam += 0.05) {
    const ll = logLikAt(lam);
    if (isFinite(ll) && ll > bestLL) { bestLL = ll; bestLam = lam; }
  }
  // golden-section around the best grid point
  let lo = Math.max(0, bestLam - 0.05), hi = Math.min(1, bestLam + 0.05);
  const gr = (Math.sqrt(5) - 1) / 2;
  for (let iter = 0; iter < 30; iter++) {
    const a = hi - gr * (hi - lo), b = lo + gr * (hi - lo);
    const fa = logLikAt(a), fb = logLikAt(b);
    if (!isFinite(fa) || !isFinite(fb)) break;
    if (fa < fb) lo = a; else hi = b;
  }
  const lamOpt = (lo + hi) / 2;
  const llOpt = logLikAt(lamOpt);
  if (isFinite(llOpt) && llOpt > bestLL) { bestLL = llOpt; bestLam = lamOpt; }

  const ll0 = logLikAt(0.0);
  const ll1 = logLikAt(1.0);

  // LRT vs λ = 0 with boundary mixture: p = 0.5·χ²₁(LRT) (Self & Liang 1987);
  // χ²₁ p = 1 − Φ√LRT here approximated by the chi-square CDF with df=1.
  const lrt = 2 * Math.max(0, bestLL - (isFinite(ll0) ? ll0 : bestLL));
  const pChi2 = Math.min(1, Math.max(0, 1 - pchisq(lrt, 1)));
  const lambdaPValue = 0.5 * pChi2;

  return {
    K, kPValue,
    lambda: bestLam, lambdaPValue,
    logLik: bestLL, logLikLambda0: ll0, logLikLambda1: ll1,
    nTaxa: n, tipNames,
    lambdaInterpretation: lambdaInterpretation(bestLam),
  };
}

/** Interpretation text for a fitted λ (signal.py lambda_interpretation). */
export function lambdaInterpretation(lambda_: number): string {
  if (lambda_ < 0.2) return 'λ ≈ 0: trait evolution is consistent with a star phylogeny (no phylogenetic dependence).';
  if (lambda_ < 0.6) return 'λ < 0.6: weak phylogenetic signal in the trait.';
  if (lambda_ < 0.9) return '0.6 ≤ λ < 0.9: moderate phylogenetic signal.';
  return 'λ ≥ 0.9: strong signal consistent with Brownian motion evolution on this tree.';
}
