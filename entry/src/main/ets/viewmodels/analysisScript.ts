/**
 * The reproducible analysis script (paleopal mode: GUI operation and script
 * are two views of the same session).
 *
 * Plain `.ts` with no ArkUI dependency, so the unit suite can cover what the
 * exported document actually says. The JOINING of the parts stays in the
 * component: `tests/etsSyntax.test.ts` pins the exact separator there, and the
 * document shape is a contract with whoever replays the script.
 */

/**
 * One entry of the reproducible-analysis script: what ran, with which
 * parameters, and when. Declared as an interface because ArkTS requires object
 * literals to correspond to an explicitly declared type -- the `.map()` in
 * restoreHistory() would not type-check with an inline anonymous shape.
 */
export interface AnalysisStep {
  analysis: string;
  params: Record<string, Object>;
  at: string;
}

/** The shape of the loaded data, as the script header reports it. */
export interface ScriptDataInfo {
  nSamples: number;
  nVariables: number;
  currentFile: string;
}

/**
 * The header lines of the reproducible script.
 *
 * @param data        the loaded data, or null when nothing is loaded
 * @param stepCount   how many analyses the session has recorded
 * @param generatedAt the ISO timestamp of the export
 */
export function analysisScriptHeader(
  data: ScriptDataInfo | null | undefined,
  stepCount: number,
  generatedAt: string): string[] {
  return [
    '// PaleoAST-Harmony reproducible analysis script',
    '// Generated: ' + generatedAt,
    data ? '// Data: ' + data.nSamples + ' x ' + data.nVariables + (data.currentFile ? ' (' + data.currentFile + ')' : '') : '// Data: not loaded',
    '// Steps: ' + stepCount,
    '',
  ];
}

/**
 * The JSON of every recorded step, in session order.
 *
 * The steps are numbered from one, and each one carries the parameters the
 * analysis actually ran with -- the caller passes the untouched params, so the
 * reserved data-fingerprint key can never end up in the script.
 */
export function analysisStepJson(history: AnalysisStep[]): string[] {
  return history.map((h, i) =>
    JSON.stringify({ step: i + 1, analysis: h.analysis, params: h.params }, null, 2)
  );
}
