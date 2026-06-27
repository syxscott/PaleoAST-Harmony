#pragma once
#include "native_api.h"

namespace MatrixOps {
    napi_value Multiply(napi_env env, napi_callback_info info);
    napi_value Transpose(napi_env env, napi_callback_info info);
    napi_value SVD(napi_env env, napi_callback_info info);
    napi_value Inverse(napi_env env, napi_callback_info info);
    napi_value Eigh(napi_env env, napi_callback_info info);
    napi_value DistanceMatrix(napi_env env, napi_callback_info info);
    napi_value Clustering(napi_env env, napi_callback_info info);
}
