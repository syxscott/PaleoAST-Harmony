/**
 * PaleoAST Native API — NAPI C++ entry point.
 *
 * Registration contract (must stay in sync — see cpp/CMakeLists.txt):
 *   CMake target  : paleoast_napi   ->  libpaleoast_napi.so
 *   nm_modname    : "paleoast_napi"
 *   ArkTS import  : import('libpaleoast_napi.so')   (core/math/NativeMath.ts)
 *   Type surface  : cpp/types/libpaleoast_napi/index.d.ts
 *
 * Return convention: a numeric payload (ArrayBuffer) on success, or a short
 * "Error:<Code>" string on a BUSINESS failure (singular matrix, dimension
 * mismatch, non-convergence). See core/ErrorHandler.h.
 */
#include "native_api.h"
#include "napi/matrix_ops.h"
#include "utils/Logger.h"

static napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor desc[] = {
        DECLARE_NAPI_FUNCTION("matrixMultiply", MatrixOps::Multiply),
        DECLARE_NAPI_FUNCTION("matrixTranspose", MatrixOps::Transpose),
        DECLARE_NAPI_FUNCTION("matrixSVD", MatrixOps::SVD),
        DECLARE_NAPI_FUNCTION("matrixInverse", MatrixOps::Inverse),
        DECLARE_NAPI_FUNCTION("matrixEigh", MatrixOps::Eigh),
        DECLARE_NAPI_FUNCTION("computeDistanceMatrix", MatrixOps::DistanceMatrix),
        DECLARE_NAPI_FUNCTION("hierarchicalClustering", MatrixOps::Clustering),
    };
    napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc);
    LOGI("libpaleoast_napi registered %{public}zu native functions", sizeof(desc) / sizeof(desc[0]));
    return exports;
}

static napi_module paleoModule = {
    .nm_version = 1,
    .nm_flags = 0,
    .nm_filename = nullptr,
    .nm_register_func = Init,
    .nm_modname = "paleoast_napi",
    .nm_priv = ((void *)0),
    .reserved = {0},
};

extern "C" __attribute__((constructor)) void RegisterModule(void) {
    napi_module_register(&paleoModule);
}
