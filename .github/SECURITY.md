# Security policy

## Reporting

This is a research tool that processes files users supply (CSV, TPS, NEXUS,
Newick, DAT, xlsx). Reports that matter most:

- a crafted input file that crashes the parser or the app;
- a crafted input that causes a wild read/write in the NAPI layer
  (`entry/src/main/cpp/`);
- any committed credential, signing key, or personal data.

Please open a private security advisory rather than a public issue.

## Secret hygiene

Signing material must never enter version control:

- `local.properties` holds signing paths and passwords and is **gitignored**;
  `local.properties.template` is the committed reference.
- `build-profile.json5` currently carries no secrets (`signingConfigs` is empty),
  so it stays tracked. **If you ever add a `signingConfigs` block with inline
  credentials, move it to `local.properties` first** — CI blocks `.p12` / `.cer` /
  `.p7b` / `.keystore` / `.jks` files and a tracked `local.properties`.
- `entry/src/main/ets/utils/` must not contain API tokens. Use the
  `*.template.ets` → `*.ets` pattern (the real file being gitignored) as the
  reference repo does for its `ApiConfig`.

## Data handling

The app is offline-first: imported datasets are read from a user-picked path
through the sandboxed file picker and analysis results stay on device unless the
user exports them. No telemetry is collected.
