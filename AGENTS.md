# PaleoAST-Harmony — instructions for AI coding assistants

## Verification

Do NOT run a full build by default. Skip build/typecheck for trivial edits
(comments, docs, colours, spacing, test names). Verify with the cheap checks
instead:

```bash
node --experimental-transform-types tests/test.mjs   # 586 unit tests, must stay green
python tools/structure_check.py                       # bracket balance + duplicate exports
node test/device/run.mjs                              # static wiring gate (19 cases)
```

`tests/etsImports.test.ts` (inside the unit suite) resolves every relative
import under `entry/src/main/` — the `.ets` layer included. The Node import
smoke test only covers `core/**`, so **nothing else in this repo checks that
a `.ets` import points at a file that exists**; a wrong relative depth is a
compile error in DevEco that every other gate passes straight through.

Only build (DevEco / hvigor) when the user explicitly asks, or when you changed
build config, dependencies, the public API, routing, global styles, or anything
affecting build output.

## Things that will bite you

- **`node` needs `--experimental-transform-types`** — `tests/runner.ts` uses
  constructor parameter properties, which strip-only mode rejects with
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
- **Tests must go through `tests/test.mjs`**, never `tests/run.ts` directly:
  core modules use extensionless relative imports and rely on
  `tests/loader.mjs`. Add a platform shim there when a new `@kit.*` import
  appears (see the `SHIMS` map).
- **Type-only names must use `import type` / `export type`.** Mixing an
  interface into a value import list makes the module graph fail to instantiate
  (`does not provide an export named 'X'`) — invisible to unit tests, so run the
  all-modules import smoke test after touching barrels.
- **Never import a deleted/renamed type as a value** in a `.d.ts` consumer path.
- **Relative imports in `ets/` must climb the right number of levels.** The
  ArkTS sources live in `entry/src/main/ets/<dir>/`, and the shared code in
  `entry/src/main/core/` — two levels up, so `'../../core/...'`. A one-level
  `'../core/...'` points at `entry/src/main/ets/core/`, which does not exist.
  Every other module in the tree gets this right; only `Splash.ets` did not.
- **Numerics**: read `.workbuddy/memory/MEMORY.md` → "已修复的关键坑" before
  touching `core/math/linalg.ts`, the xlsx/CSV parsers, `StateManager`, or
  Blomberg K. Those entries record defects that were found once already.

## Conventions

- Random processes always use the seeded PRNG from `core/math/random`, default
  `rngSeed = 42`. `Math.random()` in analysis code is a defect.
- Analysis entry points live in `core/controllers/StatisticsController.ts`;
  the UI only dispatches to them. Keep dialog parameter names in sync with the
  `runDialogAnalysisCore` switch in `ets/pages/Index.ets`.
- When fixing a bug, add a regression test whose name states the old behaviour,
  and update `docs/changes/` (see `docs/CONTRIBUTING.md`).
- Licence: this project is MIT. Reference repos under `.workbuddy/refs/` may be
  GPL-3.0 (`CalculatorX`) — **learn from them, never copy their code**.
