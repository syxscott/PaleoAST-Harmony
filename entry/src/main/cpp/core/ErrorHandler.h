/**
 * PaleoAST Native — business error codes.
 *
 * Before this existed, every failure in the NAPI layer was reported as a bare
 * `nullptr`, so the ArkTS side could only tell "something went wrong" and never
 * why. `NativeMath.ts` had the same blind spot (`Float64Array | null`).
 *
 * The convention, borrowed from how CalculatorX reports engine failures:
 *   - success  -> the numeric payload (Float64Array)
 *   - failure  -> a JS string of the form "Error:<Code>"
 * The ArkTS wrapper turns that string into `null` plus a queryable reason, so
 * existing callers keep their null-check contract while the UI can now say
 * "matrix is singular" instead of showing nothing.
 */
#pragma once

#include <exception>
#include <string>

namespace Paleo {
    /** Business-level failure causes, mapped 1:1 onto a front-end token. */
    enum class ErrorCode {
        DIV_BY_ZERO,        // division by zero
        DOMAIN_ERROR,       // argument outside the function's domain
        NOT_SQUARE,         // matrix is not square where squareness is required
        DIM_MISMATCH,       // buffer length does not match the declared shape
        SINGULAR,           // singular / rank-deficient matrix
        NO_CONVERGENCE,     // iterative solver (Jacobi, power iteration) failed
        NOT_SYMMETRIC,      // symmetric input required
        BAD_ARGUMENT,       // missing or non-numeric argument
        UNKNOWN
    };

    inline const char* ToToken(ErrorCode code) {
        switch (code) {
            case ErrorCode::DIV_BY_ZERO:    return "Error:DivByZero";
            case ErrorCode::DOMAIN_ERROR:   return "Error:Domain";
            case ErrorCode::NOT_SQUARE:     return "Error:NotSquare";
            case ErrorCode::DIM_MISMATCH:   return "Error:DimMismatch";
            case ErrorCode::SINGULAR:       return "Error:Singular";
            case ErrorCode::NO_CONVERGENCE: return "Error:NoConvergence";
            case ErrorCode::NOT_SYMMETRIC:  return "Error:NotSymmetric";
            case ErrorCode::BAD_ARGUMENT:   return "Error:BadArgument";
            default:                        return "Error:Unknown";
        }
    }

    /** Thrown by the numeric routines; caught at the NAPI boundary. */
    class Exception : public std::exception {
    private:
        ErrorCode code_;
        std::string detail_;

    public:
        explicit Exception(ErrorCode code, const std::string& detail = "")
            : code_(code), detail_(detail) {}

        ErrorCode Code() const { return code_; }
        const char* Detail() const { return detail_.c_str(); }
        const char* what() const noexcept override { return ToToken(code_); }
    };
}
