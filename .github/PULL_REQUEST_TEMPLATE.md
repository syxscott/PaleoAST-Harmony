## What changed

<!-- One or two sentences. If this fixes a numerical defect, state the old and
     new behaviour explicitly — "PCA eigenvalues were wrong" is not enough. -->

## Why

<!-- Link the issue, or the paper/R package that defines the correct result. -->

## Verification

- [ ] `node --experimental-transform-types tests/test.mjs` is green
- [ ] `python tools/structure_check.py` reports 0 problems
- [ ] All core modules still import (barrel/type-import smoke check) — required
      if you touched an `index.ts` barrel
- [ ] Regression test added for the fixed behaviour (required for bug fixes)
- [ ] `docs/changes/YYYY-MM-DD-<slug>.md` added or updated

## Risk notes

<!-- Does this change any numeric output? Which analyses are affected? Could a
     previously exported result now differ, and should the user re-run it?
     Does it touch the NAPI boundary (argument order, return contract)? -->

## Licence

- [ ] No code was copied from a GPL/AGPL reference repo (`.workbuddy/refs/`)
