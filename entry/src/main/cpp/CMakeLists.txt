cmake_minimum_required(VERSION 3.5.0)
project(PaleoASTNative)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(paleoast_napi SHARED
    native_api.cpp
    napi/matrix_ops.cpp
)

target_include_directories(paleoast_napi PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_link_libraries(paleoast_napi PUBLIC
    libace_napi.z.so
)
