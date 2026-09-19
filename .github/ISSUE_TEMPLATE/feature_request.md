---
name: Feature request
about: Suggest a new analysis, chart type, or workflow improvement
labels: enhancement
---

## What should it do

## Which reference implementation do we follow

<!-- If this is a statistical method, name the paper and, where possible, an
     R/Python package that can act as a golden reference for tests
     (e.g. vegan, geomorph, picante, ape, iNEXT, PyRate). -->

- Method / paper:
- Reference package (for cross-validation):
- Licence of that package (do NOT copy code from GPL/AGPL sources):

## UI surface

<!-- New dialog? New navigation entry? Does it need parameters, and are they
     threaded through runDialogAnalysisCore in ets/pages/Index.ets? -->

## Acceptance criteria

- [ ] Result cross-checked against the reference package on a fixed input
- [ ] Regression test added under tests/core.test.ts
- [ ] Entry name wired through NavigationTree -> handleAnalysis -> controller
