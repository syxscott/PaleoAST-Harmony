/**
 * The specimen groups the group-based analyses need.
 *
 * Two rules live here, and both used to be private methods of
 * `pages/Index.ets` where no test could reach them.
 *
 *  1. `phyloGroupMap` -- the tip -> group-name map the phylogenetic analyses
 *     contrast. A phylogenetic ANOVA needs one group label per tip; its
 *     dialog collects none, and the UI used to pass an empty object, so the
 *     core answered "p = 1, no difference" for an analysis that had never run.
 *     The groups the spreadsheet already holds are the missing input.
 *
 *  2. `usableGroupCodes` -- the refusal. `DataMatrix.getGroups()` returns null
 *     when the grouping is missing, partly unassigned, or has fewer than two
 *     groups in use. That null used to become `[]`, and ANOSIM / PERMANOVA /
 *     SIMPER / LDA happily analysed the empty vector and reported "no
 *     significant difference" -- so a user who grouped their data and ran
 *     PERMANOVA got p = 1 with no indication that the grouping never reached
 *     the model.
 *
 * Plain `.ts` with no ArkUI dependency, so the unit suite can cover both.
 */

/** Reads the group name of row `i`; undefined when the row carries none. */
export type GroupLookup = (i: number) => string | undefined;

/**
 * The tip -> group-name map for the phylogenetic analyses.
 *
 * A row that carries no group, an empty group or the spreadsheet's default
 * "Ungrouped" is left out: that is the absence of a group, not a group.
 * A name is trimmed before it is used, so " Group_A " and "Group_A" are the
 * same group.
 *
 * @param labels   the tip names, in row order
 * @param getGroup reads the group name of a row
 */
export function phyloGroupMap(labels: string[], getGroup: GroupLookup): Record<string, string> {
  const groups: Record<string, string> = {};
  for (let i = 0; i < labels.length; i++) {
    const g = getGroup(i);
    if (g === undefined) continue;
    const name = g.trim();
    if (name.length === 0 || name.toLowerCase() === 'ungrouped') continue;
    groups[labels[i]] = name;
  }
  return groups;
}

/**
 * The group codes of a usable grouping, or a refusal that says what to do.
 *
 * @param groups the codes `DataMatrix.getGroups()` produced, or null when the
 *               grouping is missing or unusable
 */
export function usableGroupCodes(groups: number[] | null | undefined): number[] {
  if (!groups) {
    throw new Error('No usable groups: assign every specimen to a named group, ' +
      'using at least two different groups, before running this analysis');
  }
  return groups;
}
