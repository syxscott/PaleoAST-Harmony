# ============================================================================
# PaleoAST-Harmony — NAPI native layer
#
# Modernised against the HarmonyOS NAPI reference layout:
#   - cmake 3.14 + PACKAGE_FIND_FILE bootstrap (the standard template block)
#   - links libhilog_ndk.z.so so the C++ layer can actually log
#   - keeps a single SHARED target matching nm_modname in native_api.cpp
#
# The target name determines the produced file: paleoast_napi -> libpaleoast_napi.so.
# That name MUST stay in sync with three other places:
#   1. native_api.cpp        -> .nm_modname = "paleoast_napi"
#   2. cpp/types/libpaleoast_napi/oh-package.json5 -> "name": "libpaleoast_napi.so"
#   3. entry/oh-package.json5 -> "libpaleoast_napi.so": "file:./src/main/cpp/types/libpaleoast_napi"
#   4. core/math/NativeMath.ts -> the dynamic import specifier
# ============================================================================
cmake_minimum_required(VERSION 3.14.0)
project(PaleoASTNative)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(NATIVERENDER_ROOT_PATH ${CMAKE_CURRENT_SOURCE_DIR})

# Standard OpenHarmony NAPI bootstrap: pulls in the NDK toolchain's package
# find file when the build system provides one.
if(DEFINED PACKAGE_FIND_FILE)
    include(${PACKAGE_FIND_FILE})
endif()

add_library(paleoast_napi SHARED
    native_api.cpp
    napi/matrix_ops.cpp
)

target_include_directories(paleoast_napi PRIVATE
    ${NATIVERENDER_ROOT_PATH}
    ${NATIVERENDER_ROOT_PATH}/core
    ${NATIVERENDER_ROOT_PATH}/utils
)

# libhilog_ndk.z.so is REQUIRED by utils/Logger.h. Without it the native layer
# cannot emit any log line, which leaves debugging to return values alone.
target_link_libraries(paleoast_napi PUBLIC
    libace_napi.z.so
    libhilog_ndk.z.so
)

# ---------------------------------------------------------------------------
# Eigen3 (optional, NOT enabled)
#
# The HarmonyOS NDK does not ship Eigen, so the numeric routines are hand-rolled
# on std::vector. If you later want to delegate to Eigen, vendor it into
# cpp/third_party/ as a tarball and use FetchContent with a local URL rather
# than a network fetch — see the CalculatorX reference for the full recipe
# (FetchContent on a vendored tarball + list(FILTER ... EXCLUDE REGEX ...) to
# drop GUI/test sources + a generated glibc stub for musl-hosted desktop libs).
# ---------------------------------------------------------------------------
