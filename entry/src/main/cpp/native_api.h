#pragma once

#include <napi/native_api.h>

#define DECLARE_NAPI_FUNCTION(name, func) \
    { (name), nullptr, (func), nullptr, nullptr, nullptr, napi_default, nullptr }
