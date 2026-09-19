/**
 * PaleoAST Native — unified logging.
 *
 * Every native file logs through these macros so the domain and tag stay
 * consistent with the ArkTS side (see entry/src/main/ets/utils/Logger.ets).
 *
 * Levels: DEBUG/INFO are compiled out of release builds by flipping
 * PALEOAST_DEBUG_LOG to 0; WARN and above always stay on.
 */
#pragma once

#include <hilog/log.h>

#undef LOG_DOMAIN
#undef LOG_TAG
#define LOG_DOMAIN 0x0000
#define LOG_TAG "PaleoAST_Native"

// Master switch: set to 0 for release builds.
#define PALEOAST_DEBUG_LOG 1

#if PALEOAST_DEBUG_LOG
    #define LOGD(fmt, ...) OH_LOG_Print(LOG_APP, LOG_DEBUG, LOG_DOMAIN, LOG_TAG, fmt, ##__VA_ARGS__)
    #define LOGI(fmt, ...) OH_LOG_Print(LOG_APP, LOG_INFO,  LOG_DOMAIN, LOG_TAG, fmt, ##__VA_ARGS__)
#else
    #define LOGD(fmt, ...)
    #define LOGI(fmt, ...)
#endif

#define LOGW(fmt, ...) OH_LOG_Print(LOG_APP, LOG_WARN,  LOG_DOMAIN, LOG_TAG, fmt, ##__VA_ARGS__)
#define LOGE(fmt, ...) OH_LOG_Print(LOG_APP, LOG_ERROR, LOG_DOMAIN, LOG_TAG, fmt, ##__VA_ARGS__)
#define LOGF(fmt, ...) OH_LOG_Print(LOG_APP, LOG_FATAL, LOG_DOMAIN, LOG_TAG, fmt, ##__VA_ARGS__)
