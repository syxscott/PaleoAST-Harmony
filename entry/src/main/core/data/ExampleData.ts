/**
 * Example datasets — port of data/loader.py.
 *
 * Files live in resources/rawfile/examples/. Loading requires a UIAbility
 * Context (resourceManager); parsing is exposed as pure functions so tests
 * and non-UI code can operate on raw text.
 */
import { parseCSV } from '../parsers/CSVParser';
import { parseTPS } from '../parsers/TPSParser';
import { parseNewick, type PhyloNode } from '../analysis/phylogenetics/index';
import { DataMatrix } from '../models/DataMatrix';

export interface ExampleDatasetInfo {
  id: string;
  fileName: string;
  description: string;
}

/** Catalogue of bundled example datasets (loader.py list_example_datasets). */
export function listExampleDatasets(): ExampleDatasetInfo[] {
  return [
    { id: 'community', fileName: 'examples/community_abundance.csv', description: 'Community abundance: 20 grassland sites × 28 plant species with a group column.' },
    { id: 'moth_wings', fileName: 'examples/moth_wings.tps', description: 'TPS landmark coordinates for moth wings (shape analysis).' },
    { id: 'primate_traits', fileName: 'examples/primate_traits.csv', description: 'Primate continuous traits for phylogenetic comparative methods.' },
    { id: 'primate_tree', fileName: 'examples/primate_tree.nwk', description: 'Primate phylogeny with branch lengths (Newick).' },
  ];
}

/** Read a bundled rawfile as text (requires a HarmonyOS Context). */
export async function readExampleText(context: Context, fileName: string): Promise<string> {
  const rm = context.resourceManager;
  const bytes: Uint8Array = await rm.getRawFileContent(fileName);
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

/** Parse the community abundance CSV into a DataMatrix (loader.py load_community). */
export function parseCommunityAbundance(text: string): DataMatrix {
  return parseCSV(text);
}

/** Parse primate traits CSV into a DataMatrix (loader.py load_primate_traits). */
export function parsePrimateTraits(text: string): DataMatrix {
  return parseCSV(text);
}

/** Parse the moth-wing TPS file (loader.py load_moth_wings). */
export function parseMothWings(text: string): ReturnType<typeof parseTPS> {
  return parseTPS(text);
}

/** Parse the primate Newick tree (loader.py load_primate_tree). */
export function parsePrimateTree(text: string): PhyloNode {
  return parseNewick(text);
}

// Minimal Context typing so core/ compiles without the full ability SDK surface
declare interface Context {
  resourceManager: {
    getRawFileContent(name: string): Promise<Uint8Array>;
  };
}
