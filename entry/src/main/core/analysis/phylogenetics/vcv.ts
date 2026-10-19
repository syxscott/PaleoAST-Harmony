/**
 * Canonical phylogenetic variance-covariance utilities — port of _core/vcv.py
 * and phylogenetics/signal.py helpers.
 *
 * Under Brownian motion with a rooted tree:
 *   V[i,i] = dist(root, tip_i)        (tip variance)
 *   V[i,j] = dist(root, LCA(i,j))     (shared covariance)
 *
 * Pagel's λ (Pagel 1999, Nature 401: 877-884):
 *   V_λ[i,j] = λ · V[i,j] for i ≠ j;  V_λ[i,i] = V[i,i]
 *   λ = 1 → full BM;  λ = 0 → star phylogeny.
 *
 * Canonical Blomberg K (Blomberg, Garland & Ives 2003, Evolution 57: 717-745):
 *   K = MSE0 / (MSE · (tr(V) − n/(1ᵀV⁻¹1))/(n−1)),   E[K] = 1 under BM
 * with GLS intercept â = (1ᵀV⁻¹1)⁻¹ 1ᵀV⁻¹y and
 *   MSE0 = Σ(y_i − â)²/(n−1),  MSE = (y−â)ᵀV⁻¹(y−â)/(n−1).
 */
import { PhyloNode } from './phylogenetics';
import { randn, seed as seedRng } from '../../math/random';
import { svd } from '../../math/linalg';
import { Matrix } from '../../math/Matrix';

export interface BrownianVCVResult {
  tipNames: string[];
  V: number[][];
}

/**
 * Brownian-motion VCV matrix in ape/Python convention, with optional
 * Pagel-λ transformation of the off-diagonal.
 *
 * The tip names are the row labels of V, so they have to be unique. Two tips
 * with the same name used to share one internal key, which corrupted the
 * whole matrix: the depth of the second tip overwrote the first one's, and
 * the LCA scan matched the tip itself instead of the LCA (so the shared path
 * length came out as each tip's own distance to the root). Fossil data is
 * full of duplicate labels ("indet.", "cf. sp."), so the key is the node
 * OBJECT and duplicate tip names are rejected with a readable error.
 */
export function brownianVCV(tree: PhyloNode, lambdaParam: number = 1.0): BrownianVCVResult {
  const leaves = tree.getLeaves();
  const n = leaves.length;
  const tipNames = leaves.map((l, i) => l.name || `tip_${i}`);

  const seen = new Map<string, number>();
  for (const name of tipNames) seen.set(name, (seen.get(name) ?? 0) + 1);
  const duplicates = [...seen.entries()].filter(([, c]) => c > 1).map(([nm]) => nm);
  if (duplicates.length > 0) {
    throw new Error(
      `brownianVCV: duplicate tip name(s): ${duplicates.join(', ')} — the covariance matrix is ` +
      `indexed by tip, so every tip needs a unique name (rename "indet." / "cf. sp." tips)`);
  }

  // Node keys are the node OBJECT, never its name: two nodes may legitimately
  // share a label (two internal nodes called "node1", a tip and an internal
  // node with the same name) and must not share a depth or a path entry.
  const depthByNode = new Map<PhyloNode, number>();
  const pathNodesByTip = new Map<PhyloNode, PhyloNode[]>();
  const walk = (node: PhyloNode, depth: number, path: PhyloNode[]): void => {
    depthByNode.set(node, depth);
    path.push(node);
    if (node.children.length === 0) {
      pathNodesByTip.set(node, [...path]);
    }
    for (const child of node.children) walk(child, depth + (child.branchLength ?? 0), path);
    path.pop();
  };
  walk(tree, 0, []);

  const V: number[][] = [];
  for (let i = 0; i < n; i++) V.push(new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    V[i][i] = depthByNode.get(leaves[i]) ?? 0;
    for (let j = i + 1; j < n; j++) {
      // LCA depth: the deepest shared NODE on the two root paths
      const pathI = pathNodesByTip.get(leaves[i]) ?? [];
      const pathJ = pathNodesByTip.get(leaves[j]) ?? [];
      const setJ = new Set<PhyloNode>(pathJ);
      let lcaDepth = 0;
      for (let k = pathI.length - 1; k >= 0; k--) {
        if (setJ.has(pathI[k])) {
          lcaDepth = depthByNode.get(pathI[k]) ?? 0;
          break;
        }
      }
      V[i][j] = V[j][i] = lcaDepth;
    }
  }

  // Pagel λ transform: off-diagonal only
  const lam = Math.max(0, Math.min(1, lambdaParam));
  if (lam !== 1.0) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j) V[i][j] *= lam;
      }
    }
  }
  return { tipNames, V };
}

/** Generic n×n matrix inverse via Gauss-Jordan with partial pivoting. */
function matInv(M: number[][]): number[][] | null {
  const n = M.length;
  const aug: number[][] = M.map((row, i) => [...row, ...new Array(n).fill(0).map((_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    if (Math.abs(aug[maxRow][col]) < 1e-12) return null;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }
  return aug.map(row => row.slice(n));
}

/**
 * Canonical Blomberg K from a trait vector and an ape-convention VCV
 * (diag = root-to-tip, off-diag = shared path).
 *
 * The FORMULA is the canonical one and is unchanged. The FAILURE CHANNEL is
 * not: every degenerate input used to be folded into a number, and the two
 * most dangerous cases were
 *   - a constant trait ([5,5,5]) -> 1.5000000001062503, the ratio of two
 *     ~1e-30 quantities, i.e. floating-point noise that reads as "K = 1.5,
 *     strong signal" in a paper;
 *   - a NaN trait, a singular V, or n < 3 -> 0, and K = 0 is the legitimate
 *     value for "no phylogenetic signal", so a failure was indistinguishable
 *     from a conclusion.
 * Every one of those now throws with a message that says what is wrong.
 *
 * Blomberg's K is defined so that E[K] = 1 when the trait evolves under
 * Brownian motion on the supplied tree. That fixes the normalisation:
 *
 *   K = MSE0 / (MSE · N),   N = (tr(V) − n/(1ᵀV⁻¹1)) / (n−1)
 *
 * where both MSE0 and MSE are computed about the GLS (phylogenetic) mean
 * â = (1ᵀV⁻¹1)⁻¹1ᵀV⁻¹y:
 *
 *   MSE0 = Σ(y_i − â)² / (n−1)
 *   MSE  = (y − â)ᵀV⁻¹(y − â) / (n−1)
 *
 * E[MSE0] = N and E[MSE] = 1 under BM, so E[K] = 1. Two deviations from this
 * were present before and made K biased low on every non-star tree (measured
 * by simulating BM on the tree's own VCV, 20k replicates):
 *   - the numerator used the ARITHMETIC mean instead of the GLS mean;
 *   - N was `tr(V)/n` instead of `(tr(V) − n/(1ᵀV⁻¹1))/(n−1)`.
 * E[K] came out 0.83 for ((H:1,C:1):1,G:2) and 0.76 for
 * (((A:1,B:1):1,C:1):1,D:3), where it must be 1.
 */
export function blombergKFromVCV(y: number[], V: number[][]): number {
  const n = y.length;
  if (n < 3) {
    throw new Error(`blombergKFromVCV: Blomberg K needs at least 3 taxa, got ${n}`);
  }
  if (!V || V.length !== n || V.some(row => row.length !== n)) {
    throw new Error(`blombergKFromVCV: V must be a ${n}x${n} matrix`);
  }
  for (let i = 0; i < n; i++) {
    if (!isFinite(y[i])) {
      throw new Error(
        `blombergKFromVCV: trait value ${i} is ${y[i]} - a missing (NaN) or non-finite value ` +
        `makes K undefined; drop or impute that tip first`);
    }
    for (let j = 0; j < n; j++) {
      if (!isFinite(V[i][j])) throw new Error(`blombergKFromVCV: V[${i}][${j}] is not finite`);
    }
  }
  // Zero variance: every tip carries the same value, so both mean-squared
  // errors are ~0 and K is 0/0. This is checked BEFORE the arithmetic,
  // because the arithmetic turns it into noise.
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (y[i] < yMin) yMin = y[i];
    if (y[i] > yMax) yMax = y[i];
  }
  if (!(yMax > yMin)) {
    throw new Error(
      `blombergKFromVCV: the trait has zero variance (every tip is ${yMin}) - ` +
      `Blomberg K is undefined for a constant trait`);
  }

  const Vj = V.map(row => [...row]);
  for (let i = 0; i < n; i++) Vj[i][i] += 1e-10;
  const Vinv = matInv(Vj);
  if (!Vinv) {
    throw new Error('blombergKFromVCV: the VCV matrix is singular - K is undefined for this tree');
  }

  let oneViOne = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) oneViOne += Vinv[i][j];
  if (!(oneViOne > 0)) {
    throw new Error('blombergKFromVCV: the GLS mean is not defined (1TV^-1 1 <= 0)');
  }

  let oneViY = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += Vinv[i][j] * y[j];
    oneViY += s;
  }
  // GLS / phylogenetic mean — used for BOTH mean-squared errors.
  const aHat = oneViY / oneViOne;
  const resid = y.map(v => v - aHat);

  // residᵀ V⁻¹ resid
  let vinvResid: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += Vinv[i][j] * resid[j];
    vinvResid[i] = s;
  }
  let quad = 0;
  for (let i = 0; i < n; i++) quad += resid[i] * vinvResid[i];
  const mseGls = quad / (n - 1);

  const mse0 = resid.reduce((s, v) => s + v * v, 0) / (n - 1);

  let trace = 0;
  for (let i = 0; i < n; i++) trace += V[i][i];
  // Normaliser that makes E[K] = 1 under BM.
  const norm = (trace - n / oneViOne) / (n - 1);

  const denom = mseGls * norm;
  if (!isFinite(denom) || !(denom > 0)) {
    throw new Error(
      `blombergKFromVCV: the normaliser is not positive (denominator ${denom}) - K is undefined ` +
      `for this trait/tree combination`);
  }
  const k = mse0 / denom;
  if (!isFinite(k)) {
    throw new Error('blombergKFromVCV: K is not finite - the trait/tree combination is degenerate');
  }
  return k;
}

export interface BMSimulationResult {
  tipNames: string[];
  tipValues: number[];
  /** Simulated trait for every node (incl. root), keyed by node object. */
  nodeValues: Map<PhyloNode, number>;
}

/**
 * Simulate a continuous trait under Brownian motion on the tree
 * (signal.py simulate_brownian_motion): each daughter trait is
 * parent trait + σ·√branchLength·N(0,1).
 */
export function simulateBrownianMotion(
  tree: PhyloNode,
  rootValue: number,
  sigma: number,
  rngSeed?: number,
): BMSimulationResult {
  if (rngSeed !== undefined) seedRng(rngSeed);
  const nodeValues = new Map<PhyloNode, number>();
  nodeValues.set(tree, rootValue);
  const walk = (node: PhyloNode): void => {
    const parentValue = nodeValues.get(node) ?? rootValue;
    for (const child of node.children) {
      const bl = child.branchLength ?? 0;
      const draw = randn() * sigma * Math.sqrt(Math.max(0, bl));
      nodeValues.set(child, parentValue + draw);
      walk(child);
    }
  };
  walk(tree);

  const leaves = tree.getLeaves();
  return {
    tipNames: leaves.map(l => l.name ?? 'tip'),
    tipValues: leaves.map(l => nodeValues.get(l) ?? 0),
    nodeValues,
  };
}

/**
 * Gaussian log-likelihood of a trait under BM with VCV V, with GLS mean
 * centering and profiled σ² (the corrections Python applies before
 * optimizing λ — without them λ̂ is systematically biased):
 *
 *   μ̂ = (1ᵀV⁻¹y)/(1ᵀV⁻¹1),  σ̂² = eᵀV⁻¹e/n  (profile MLE),
 *   logLik = −n/2·ln(2πσ̂²) − ½·ln det(V) − eᵀV⁻¹e/(2σ̂²).
 */
export function phyloBMLogLik(V: number[][], y: number[]): number {
  const n = y.length;
  if (n < 2) return NaN;
  const Vj = V.map((row, i) => row.map((v, j) => (i === j ? v + 1e-10 : v)));
  const Vinv = matInv(Vj);
  if (!Vinv) return NaN;

  // log det(V) via LU-free approach: use the trace-free identity through Cholesky
  // fallback — compute det via Gauss elimination on a copy
  let logDet = 0;
  {
    const M = Vj.map(row => [...row]);
    let sign = 1;
    for (let col = 0; col < n; col++) {
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
      }
      if (Math.abs(M[maxRow][col]) < 1e-300) return NaN;
      if (maxRow !== col) { [M[col], M[maxRow]] = [M[maxRow], M[col]]; sign = -sign; }
      const pivot = M[col][col];
      logDet += Math.log(Math.abs(pivot));
      for (let row = col + 1; row < n; row++) {
        const factor = M[row][col] / pivot;
        for (let j = col; j < n; j++) M[row][j] -= factor * M[col][j];
      }
    }
    if (sign < 0) return NaN; // negative determinant → not a valid covariance
  }

  let oneViOne = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) oneViOne += Vinv[i][j];
  if (oneViOne <= 0) return NaN;

  let oneViY = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += Vinv[i][j] * y[j];
    oneViY += s;
  }
  const muHat = oneViY / oneViOne;
  const e = y.map(v => v - muHat);

  const vinvE: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += Vinv[i][j] * e[j];
    vinvE[i] = s;
  }
  const quad = e.reduce((s, ev, i) => s + ev * vinvE[i], 0);
  const sigma2 = quad / n; // profile MLE
  if (sigma2 <= 0) return NaN;

  return -0.5 * n * Math.log(2 * Math.PI * sigma2) - 0.5 * logDet - quad / (2 * sigma2);
}

// ─── Kabsch rotation (port of _core/rotation.py) ────────────────────────────

/** k×k matrix helpers local to the Kabsch implementation. */
function _kabschTranspose(M: number[][]): number[][] {
  const r = M.length, c = M[0].length;
  const out: number[][] = Array.from({ length: c }, () => new Array(r).fill(0));
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[j][i] = M[i][j];
  return out;
}

function _kabschMultiply(A: number[][], B: number[][]): number[][] {
  const n = A.length, m = B[0].length, inner = B.length;
  const out: number[][] = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let p = 0; p < inner; p++) s += A[i][p] * B[p][j];
      out[i][j] = s;
    }
  }
  return out;
}

function _kabschDet(M: number[][]): number {
  const n = M.length;
  const a = M.map(row => [...row]);
  let det = 1;
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[maxRow][col])) maxRow = row;
    }
    if (Math.abs(a[maxRow][col]) < 1e-300) return 0;
    if (maxRow !== col) { const t = a[col]; a[col] = a[maxRow]; a[maxRow] = t; det = -det; }
    det *= a[col][col];
    for (let row = col + 1; row < n; row++) {
      const f = a[row][col] / a[col][col];
      for (let j = col; j < n; j++) a[row][j] -= f * a[col][j];
    }
  }
  return det;
}

/**
 * Generic N-dimensional Kabsch alignment: finds rotation R minimising
 * Σ‖R·x_i − y_i‖² over paired point sets via SVD of the covariance with
 * reflection correction (Kabsch 1976). allowScale adds the uniform scale
 * s = Σσ_i / Σ‖x−x̄‖². Works for any dimensionality.
 */
export function kabschRotation(
  X: number[][], Y: number[][], allowScale: boolean = false,
): { R: number[][]; scale: number; dims: number } {
  const n = Math.min(X.length, Y.length);
  if (n === 0) throw new Error('kabschRotation: empty point sets');
  const k = X[0].length;
  if (Y[0].length !== k) throw new Error('kabschRotation: dimension mismatch');

  const cx = new Array(k).fill(0), cy = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < k; d++) { cx[d] += X[i][d] / n; cy[d] += Y[i][d] / n; }
  }

  // covariance H = Xcᵀ·Yc
  const H: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) {
        H[a][b] += (X[i][a] - cx[a]) * (Y[i][b] - cy[b]);
      }
    }
  }

  const { U, S, Vt } = svd(Matrix.from2D(H));
  const V = _kabschTranspose(Vt.to2D());
  // reflection correction: flip last column of V when det(V·Uᵀ) < 0
  if (_kabschDet(_kabschMultiply(V, _kabschTranspose(U.to2D()))) < 0) {
    for (let r = 0; r < k; r++) V[r][k - 1] = -V[r][k - 1];
  }
  const R = _kabschMultiply(V, _kabschTranspose(U.to2D()));

  let scale = 1;
  if (allowScale) {
    let den = 0;
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < k; a++) {
        const dx = X[i][a] - cx[a];
        den += dx * dx;
      }
    }
    const num = S.reduce((s2, v) => s2 + v, 0);
    scale = den > 0 ? num / den : 1;
  }
  return { R, scale, dims: k };
}

/** Convenience wrapper: rotation aligning 3-D X onto 3-D Y. */
export function kabschRotation3D(X: number[][], Y: number[][]): number[][] {
  return kabschRotation(X, Y, false).R;
}
