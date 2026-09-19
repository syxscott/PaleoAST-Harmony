---
name: Bug report
about: Something computes the wrong number, crashes, or a control does nothing
labels: bug
---

## What happened

<!-- Describe the observable behaviour. If the wrong value is involved, give both
     the value you got and the value you expected. -->

## How to reproduce

1.
2.
3.

## Expected result

## Which analysis / module

<!-- e.g. PCA (multivariate), Rarefaction (diversity), Excel import, UI dialog -->

## Input data

<!-- Attach a minimal file if possible (CSV/TPS/NEXUS/xlsx). Redact anything sensitive. -->

## Environment

- Device / emulator:
- HarmonyOS version:
- App version / commit:
- Previewer or real device:

## Numerical-correctness checklist

<!-- Worth a glance — these are the areas with prior defects. -->

- [ ] This is a value produced by an analysis (not a UI/layout issue)
- [ ] I checked whether the pure-TS path and the NAPI path could differ
- [ ] I can state the expected value and where it comes from (paper, R package, hand calculation)
