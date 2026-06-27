/**
 * PaleoAST Native API — NAPI C++ entry point
 * Exposes high-performance linear algebra to ArkTS.
 */
#include "napi/native_api.h"
#include "napi/matrix_ops.h"
#include "napi/linalg_c.h"

static napi_value Init(napi_env env, napi_value exports) {
    // Register matrix operations
    napi_property_descriptor matrixDesc[] = {
        DECLARE_NAPI_FUNCTION("matrixMultiply", MatrixOps::Multiply),
        DECLARE_NAPI_FUNCTION("matrixTranspose", MatrixOps::Transpose),
        DECLARE_NAPI_FUNCTION("matrixSVD", MatrixOps::SVD),
        DECLARE_NAPI_FUNCTION("matrixInverse", MatrixOps::Inverse),
        DECLARE_NAPI_FUNCTION("matrixEigh", MatrixOps::Eigh),
        DECLARE_NAPI_FUNCTION("computeDistanceMatrix", MatrixOps::DistanceMatrix),
        DECLARE_NAPI_FUNCTION("hierarchicalClustering", MatrixOps::Clustering),
    };
    napi_define_properties(env, exports, sizeof(matrixDesc) / sizeof(matrixDesc[0]), matrixDesc);
    return exports;
}

static napi_module demoModule = {
    .nm_version = 1,
    .nm_flags = 0,
    .nm_filename = nullptr,
    .nm_register_func = Init,
    .nm_modname = "paleoast_napi",
    .nm_priv = ((void *)0),
    .reserved = {0},
};

extern "C" __attribute__((constructor)) void RegisterModule(void) {
    napi_module_register(&demoModule);
}
