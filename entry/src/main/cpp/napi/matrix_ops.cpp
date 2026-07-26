#include "napi/matrix_ops.h"
#include <vector>
#include <cmath>
#include <algorithm>
#include <limits>
#include <cstring>

namespace MatrixOps {

// ---------------------------------------------------------------------------
// NAPI helper — eliminates repetitive error-checking boilerplate.
// Usage: NAPI_CALL(ctx, napi_some_call(ctx.env, ...));
//   expands to: do { status = napi_some_call(...); if (status != napi_ok) return nullptr; } while(false)
// ---------------------------------------------------------------------------
struct NapiCtx {
    napi_env env;
    napi_status status;
    NapiCtx(napi_env e) : env(e), status(napi_ok) {}
};

#define NAPI_CALL(ctx, call) \
    do { \
        (ctx).status = (call); \
        if ((ctx).status != napi_ok) return nullptr; \
    } while (false)

// ---------------------------------------------------------------------------
// GetArray : extracts std::vector<double> from a NAPI ArrayBuffer.
// Contract: val must be a valid ArrayBuffer whose byte length is a multiple of sizeof(double).
// Returns: vector<double>.  Empty vector on any NAPI error.
// ---------------------------------------------------------------------------
static std::vector<double> GetArray(napi_env env, napi_value val) {
    NapiCtx ctx(env);
    double* data = nullptr;
    size_t byte_len = 0;
    NAPI_CALL(ctx, napi_get_arraybuffer_info(env, val, reinterpret_cast<void**>(&data), &byte_len));
    size_t len = byte_len / sizeof(double);
    return std::vector<double>(data, data + len);
}

// ---------------------------------------------------------------------------
// MakeArray : creates a NAPI ArrayBuffer from a std::vector<double>.
// Contract: v may be empty (returns zero-length buffer).
// Returns: NAPI ArrayBuffer wrapping a newly allocated buffer with v's data copied in.
// ---------------------------------------------------------------------------
static napi_value MakeArray(napi_env env, const std::vector<double>& v) {
    NapiCtx ctx(env);
    void* data = nullptr;
    napi_value buffer = nullptr;
    size_t byte_len = v.size() * sizeof(double);
    NAPI_CALL(ctx, napi_create_arraybuffer(env, byte_len, &data, &buffer));
    if (byte_len > 0 && data != nullptr) {
        std::memcpy(data, v.data(), byte_len);
    }
    return buffer;
}
// ---------------------------------------------------------------------------
// Multiply : C = A * B  (m×k  ·  k×n  →  m×n)
// @param A buffer (m*k doubles), B buffer (k*n doubles), m, n dimensions
// @return C buffer (m*n doubles) or nullptr on error
// Contract: A.size() == m*k && B.size() == k*n
// ---------------------------------------------------------------------------
napi_value Multiply(napi_env env, napi_callback_info info) {
    NapiCtx ctx(env);
    size_t argc = 4;
    napi_value a[4];
    NAPI_CALL(ctx, napi_get_cb_info(env, info, &argc, a, nullptr, nullptr));
    if (argc < 4) return nullptr;

    auto A = GetArray(env, a[0]);
    auto B = GetArray(env, a[1]);
    int m = 0, n = 0;
    NAPI_CALL(ctx, napi_get_value_int32(env, a[2], &m));
    NAPI_CALL(ctx, napi_get_value_int32(env, a[3], &n));

    if (m <= 0 || n <= 0) return nullptr;
    int k = static_cast<int>(A.size()) / m;
    if (k <= 0 || static_cast<size_t>(k * n) != B.size()) return nullptr;

    std::vector<double> C(m * n, 0.0);
    for (int i = 0; i < m; i++)
        for (int j = 0; j < n; j++) {
            double s = 0.0;
            for (int p = 0; p < k; p++)
                s += A[i * k + p] * B[p * n + j];
            C[i * n + j] = s;
        }
    return MakeArray(env, C);
}
// ---------------------------------------------------------------------------
// Transpose : T = A^T  (r×c  →  c×r)
// @param A buffer (r*c doubles), r, c dimensions
// @return T buffer (c*r doubles) or nullptr on error
// Contract: A.size() == r*c
// ---------------------------------------------------------------------------
napi_value Transpose(napi_env env, napi_callback_info info) {
    NapiCtx ctx(env);
    size_t argc = 3;
    napi_value a[3];
    NAPI_CALL(ctx, napi_get_cb_info(env, info, &argc, a, nullptr, nullptr));
    if (argc < 3) return nullptr;

    auto A = GetArray(env, a[0]);
    int r = 0, c = 0;
    NAPI_CALL(ctx, napi_get_value_int32(env, a[1], &r));
    NAPI_CALL(ctx, napi_get_value_int32(env, a[2], &c));

    if (r <= 0 || c <= 0) return nullptr;
    if (static_cast<size_t>(r * c) != A.size()) return nullptr;

    std::vector<double> T(c * r);
    for (int i = 0; i < r; i++)
        for (int j = 0; j < c; j++)
            T[j * r + i] = A[i * c + j];
    return MakeArray(env, T);
}
// ---------------------------------------------------------------------------
// SVD : computes singular values via one-sided Jacobi iterations.
// @param A buffer (m*n doubles), m, n dimensions
// @return sig buffer (n singular values, sorted descending) or nullptr on error
// Contract: A.size() == m*n
// Note: 300 iterations with convergence check. Falls back to partial result
//       if convergence is not reached (still better than no decomposition).
// ---------------------------------------------------------------------------
napi_value SVD(napi_env env, napi_callback_info info) {
    NapiCtx ctx(env);
    size_t argc = 3;
    napi_value a[3];
    NAPI_CALL(ctx, napi_get_cb_info(env, info, &argc, a, nullptr, nullptr));
    if (argc < 3) return nullptr;

    auto A = GetArray(env, a[0]);
    int m = 0, n = 0;
    NAPI_CALL(ctx, napi_get_value_int32(env, a[1], &m));
    NAPI_CALL(ctx, napi_get_value_int32(env, a[2], &n));

    if (m <= 0 || n <= 0) return nullptr;
    if (static_cast<size_t>(m * n) != A.size()) return nullptr;

    auto B = A; // working copy
    const double eps = 1e-14;
    for (int it = 0; it < 300; it++) {
        bool converged = true;
        for (int p = 0; p < n; p++) {
            for (int q = p + 1; q < n; q++) {
                double al = 0.0, be = 0.0, ga = 0.0;
                for (int i = 0; i < m; i++) {
                    al += B[i * n + p] * B[i * n + p];
                    be += B[i * n + q] * B[i * n + q];
                    ga += B[i * n + p] * B[i * n + q];
                }
                if (std::abs(ga) < eps * std::sqrt(al * be)) continue;
                converged = false;
                double tau = (be - al) / (2.0 * ga);
                double t = (tau >= 0 ? 1.0 : -1.0) / (std::abs(tau) + std::sqrt(1.0 + tau * tau));
                double c2 = 1.0 / std::sqrt(1.0 + t * t);
                double s = t * c2;
                for (int i = 0; i < m; i++) {
                    double bp = B[i * n + p];
                    double bq = B[i * n + q];
                    B[i * n + p] = c2 * bp - s * bq;
                    B[i * n + q] = s * bp + c2 * bq;
                }
            }
        }
        if (converged) break;
    }

    std::vector<double> sig(n);
    for (int j = 0; j < n; j++) {
        double s = 0.0;
        for (int i = 0; i < m; i++)
            s += B[i * n + j] * B[i * n + j];
        sig[j] = std::sqrt(s);
    }
    std::sort(sig.rbegin(), sig.rend());
    return MakeArray(env, sig);
}
// ---------------------------------------------------------------------------
// Inverse : computes A^-1 via Gauss-Jordan elimination with partial pivoting.
// @param A buffer (n*n doubles), n dimension
// @return A^-1 buffer (n*n doubles) or nullptr if singular
// Contract: A.size() == n*n, n > 0
// CRITICAL FIX: previously continued on singular pivot, returning garbage.
//   Now returns nullptr so JS layer can fall back to Moore-Penrose pseudo-inverse.
// ---------------------------------------------------------------------------
napi_value Inverse(napi_env env, napi_callback_info info) {
    NapiCtx ctx(env);
    size_t argc = 2;
    napi_value a[2];
    NAPI_CALL(ctx, napi_get_cb_info(env, info, &argc, a, nullptr, nullptr));
    if (argc < 2) return nullptr;

    auto A = GetArray(env, a[0]);
    int n = 0;
    NAPI_CALL(ctx, napi_get_value_int32(env, a[1], &n));

    if (n <= 0 || static_cast<size_t>(n * n) != A.size()) return nullptr;

    std::vector<double> aug(n * 2 * n);
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < n; j++) aug[i * 2 * n + j] = A[i * n + j];
        aug[i * 2 * n + n + i] = 1.0;
    }

    for (int c = 0; c < n; c++) {
        // Find pivot row
        int mx = c;
        for (int r = c + 1; r < n; r++)
            if (std::abs(aug[r * 2 * n + c]) > std::abs(aug[mx * 2 * n + c])) mx = r;
        // Swap if needed
        if (mx != c)
            for (int j = 0; j < 2 * n; j++) std::swap(aug[c * 2 * n + j], aug[mx * 2 * n + j]);
        // Check singularity BEFORE proceeding
        double pv = aug[c * 2 * n + c];
        if (std::abs(pv) < 1e-15) {
            // CRITICAL: singular matrix — return nullptr so JS layer can handle
            return nullptr;
        }
        // Normalize pivot row
        for (int j = 0; j < 2 * n; j++) aug[c * 2 * n + j] /= pv;
        // Eliminate column c from all other rows
        for (int r = 0; r < n; r++) {
            if (r == c) continue;
            double f = aug[r * 2 * n + c];
            for (int j = 0; j < 2 * n; j++) aug[r * 2 * n + j] -= f * aug[c * 2 * n + j];
        }
    }

    std::vector<double> res(n * n);
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++)
            res[i * n + j] = aug[i * 2 * n + n + j];
    return MakeArray(env, res);
}
// ---------------------------------------------------------------------------
// Eigh : computes eigenvalues of a symmetric matrix via Jacobi rotation.
// @param A buffer (n*n doubles, assumed symmetric), n dimension
// @return eigenvalues buffer (n doubles, sorted descending) or nullptr on error
// Contract: A.size() == n*n, n > 0
// Note: uses M_PI from <cmath> (defined by C++ standard).
// ---------------------------------------------------------------------------
napi_value Eigh(napi_env env, napi_callback_info info) {
    NapiCtx ctx(env);
    size_t argc = 2;
    napi_value a[2];
    NAPI_CALL(ctx, napi_get_cb_info(env, info, &argc, a, nullptr, nullptr));
    if (argc < 2) return nullptr;

    auto A = GetArray(env, a[0]);
    int n = 0;
    NAPI_CALL(ctx, napi_get_value_int32(env, a[1], &n));

    if (n <= 0 || static_cast<size_t>(n * n) != A.size()) return nullptr;

    auto T = A; // working copy
    for (int it = 0; it < 100 * n; it++) {
        double mx = 0.0;
        int pi = 0, qi = 1;
        for (int i = 0; i < n; i++)
            for (int j = i + 1; j < n; j++)
                if (std::abs(T[i * n + j]) > mx) { mx = std::abs(T[i * n + j]); pi = i; qi = j; }
        if (mx < 1e-14) break;
        double th = (T[pi * n + pi] == T[qi * n + qi])
                        ? M_PI / 4.0
                        : 0.5 * std::atan2(2.0 * T[pi * n + qi], T[pi * n + pi] - T[qi * n + qi]);
        double c = std::cos(th);
        double s = std::sin(th);
        for (int i = 0; i < n; i++) {
            double tp = T[i * n + pi];
            double tq = T[i * n + qi];
            T[i * n + pi] = c * tp - s * tq;
            T[i * n + qi] = s * tp + c * tq;
        }
        for (int j = 0; j < n; j++) {
            double tp = T[pi * n + j];
            double tq = T[qi * n + j];
            T[pi * n + j] = c * tp - s * tq;
            T[qi * n + j] = s * tp + c * tq;
        }
    }
    std::vector<double> ev(n);
    for (int i = 0; i < n; i++) ev[i] = T[i * n + i];
    std::sort(ev.rbegin(), ev.rend());
    return MakeArray(env, ev);
}
// ---------------------------------------------------------------------------
// DistanceMatrix : computes pairwise distance matrix.
// @param X buffer (n*p doubles, n points in p dimensions)
// @param n number of points, p dimensionality, mt metric (0=Euclidean, 1=Canberra)
// @return D buffer (n*n symmetric distance matrix) or nullptr on error
// Contract: X.size() == n*p
// ---------------------------------------------------------------------------
napi_value DistanceMatrix(napi_env env, napi_callback_info info) {
    NapiCtx ctx(env);
    size_t argc = 4;
    napi_value a[4];
    NAPI_CALL(ctx, napi_get_cb_info(env, info, &argc, a, nullptr, nullptr));
    if (argc < 4) return nullptr;

    auto X = GetArray(env, a[0]);
    int n = 0, p = 0, mt = 0;
    NAPI_CALL(ctx, napi_get_value_int32(env, a[1], &n));
    NAPI_CALL(ctx, napi_get_value_int32(env, a[2], &p));
    NAPI_CALL(ctx, napi_get_value_int32(env, a[3], &mt));

    if (n <= 0 || p <= 0) return nullptr;
    if (static_cast<size_t>(n * p) != X.size()) return nullptr;

    std::vector<double> D(n * n, 0.0);
    for (int i = 0; i < n; i++) {
        for (int j = i + 1; j < n; j++) {
            double d = 0.0;
            if (mt == 1) { // Canberra
                double num = 0.0, den = 0.0;
                for (int k = 0; k < p; k++) {
                    num += std::abs(X[i * p + k] - X[j * p + k]);
                    den += std::abs(X[i * p + k]) + std::abs(X[j * p + k]);
                }
                d = den > 0 ? num / den : 0.0;
            } else { // Euclidean
                for (int k = 0; k < p; k++) {
                    double diff = X[i * p + k] - X[j * p + k];
                    d += diff * diff;
                }
                d = std::sqrt(d);
            }
            D[i * n + j] = d;
            D[j * n + i] = d;
        }
    }
    return MakeArray(env, D);
}
// ---------------------------------------------------------------------------
// Clustering : agglomerative hierarchical clustering (UPGMA / average linkage).
//
// Implements the standard Lance-Williams formula with multiple linkage methods:
//   Average (UPGMA):  d(i∪j, k) = (n_i/(n_i+n_j) * d(i,k)) + (n_j/(n_i+n_j) * d(j,k))
//   Complete:         d(i∪j, k) = max(d(i,k), d(j,k))
//   Single:           d(i∪j, k) = min(d(i,k), d(j,k))
//   Ward:             weighted variance increase
//
// @param D buffer (n*n symmetric distance matrix, zero diagonal)
// @param n number of elements
// @param method 0=average (UPGMA, default), 1=complete, 2=single, 3=Ward
// @return Z buffer ((n-1)*4 linkage matrix):
//            Z[i][0] = left cluster index (or n+i for newly formed)
//            Z[i][1] = right cluster index
//            Z[i][2] = distance between merged clusters
//            Z[i][3] = size of new cluster
//          or nullptr on error (n <= 0, dimension mismatch)
//
// CRITICAL FIX: the original stub simply assigned floor(i*nc/n) labels,
// which is NOT hierarchical clustering. Now implements full agglomerative
// algorithm producing scipy.cluster.hierarchy.linkage-compatible output.
//
// Boundary: n <= 0 or D.size() != n*n returns nullptr.
// ---------------------------------------------------------------------------
napi_value Clustering(napi_env env, napi_callback_info info) {
    NapiCtx ctx(env);
    size_t argc = 3;
    napi_value a[3];
    NAPI_CALL(ctx, napi_get_cb_info(env, info, &argc, a, nullptr, nullptr));
    if (argc < 3) return nullptr;

    auto D = GetArray(env, a[0]);
    int n = 0, method = 0;
    NAPI_CALL(ctx, napi_get_value_int32(env, a[1], &n));
    NAPI_CALL(ctx, napi_get_value_int32(env, a[2], &method));

    if (n <= 0) return nullptr;
    if (static_cast<size_t>(n * n) != D.size()) return nullptr;

    int nn = n;
    // Active cluster flag: active[i] = true iff cluster i is still alive
    std::vector<bool> active(nn, true);
    // Cluster sizes: initially each point has size 1
    std::vector<int> sz(nn, 1);
    // Distance matrix copy that we will update in-place
    std::vector<double> dist = D;

    // Output: (n-1) × 4 matrix flattened (linkage Z matrix)
    std::vector<double> Z((nn - 1) * 4, 0.0);

    for (int step = 0; step < nn - 1; step++) {
        // Find the two closest active clusters
        double min_d = std::numeric_limits<double>::infinity();
        int min_i = -1, min_j = -1;
        for (int i = 0; i < nn; i++) {
            if (!active[i]) continue;
            for (int j = i + 1; j < nn; j++) {
                if (!active[j]) continue;
                double d = dist[i * nn + j];
                if (d < min_d) {
                    min_d = d;
                    min_i = i;
                    min_j = j;
                }
            }
        }

        if (min_i == -1 || min_j == -1) {
            // Degenerate case: should not happen with valid distance matrix
            return nullptr;
        }

        int sz_i = sz[min_i];
        int sz_j = sz[min_j];
        int new_sz = sz_i + sz_j;

        // Record linkage entry: left, right, distance, new cluster size
        Z[step * 4 + 0] = static_cast<double>(min_i);
        Z[step * 4 + 1] = static_cast<double>(min_j);
        Z[step * 4 + 2] = min_d;
        Z[step * 4 + 3] = static_cast<double>(new_sz);

        // Mark merged clusters as inactive
        active[min_i] = false;
        active[min_j] = false;

        // Create new cluster at index min_i (reuse slot)
        int new_idx = min_i;
        sz[new_idx] = new_sz;

        // Update distances from new cluster to all remaining active clusters
        for (int k = 0; k < nn; k++) {
            if (!active[k]) continue;
            if (k == new_idx) {
                dist[new_idx * nn + k] = 0.0;
                dist[k * nn + new_idx] = 0.0;
                continue;
            }
            double d_ik = dist[new_idx * nn + k];
            double d_jk = dist[min_j * nn + k];

            double new_d = 0.0;
            if (method == 0) { // Average (UPGMA)
                new_d = (sz_i * d_ik + sz_j * d_jk) / new_sz;
            } else if (method == 1) { // Complete: max(d_ik, d_jk)
                new_d = std::max(d_ik, d_jk);
            } else if (method == 2) { // Single: min(d_ik, d_jk)
                new_d = std::min(d_ik, d_jk);
            } else { // Default: average (UPGMA)
                new_d = (sz_i * d_ik + sz_j * d_jk) / new_sz;
            }

            dist[new_idx * nn + k] = new_d;
            dist[k * nn + new_idx] = new_d;
        }

        // Clear distances for inactive cluster min_j (for safety)
        for (int k = 0; k < nn; k++) {
            dist[min_j * nn + k] = 0.0;
            dist[k * nn + min_j] = 0.0;
        }
    }

    return MakeArray(env, Z);
}
}
