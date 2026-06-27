/**
 * PaleoAST Native API — NAPI C++ entry point
 */
#include "native_api.h"
#include "napi/matrix_ops.h"

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
