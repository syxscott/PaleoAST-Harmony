/**
 * File Manager - HarmonyOS file system abstraction.
 */
export class FileManager {
  static getExtension(path: string): string {
    return path.split('.').pop()?.toLowerCase() || '';
  }

  static getBaseName(path: string): string {
    return path.split('/').pop()?.split('').pop() || path;
  }

  static isTextFile(path: string): boolean {
    return ['csv', 'tsv', 'txt', 'tps', 'nxs', 'nex', 'tre', 'newick', 'dat'].includes(FileManager.getExtension(path));
  }

  static getFileType(path: string): string {
    const ext = FileManager.getExtension(path);
    const map: Record<string, string> = {
      csv: 'csv', tsv: 'csv', tps: 'tps',
      nxs: 'nexus', nex: 'nexus', tre: 'newick',
      newick: 'newick', dat: 'dat', xlsx: 'excel',
    };
    return map[ext] || 'unknown';
  }

  static async readText(path: string): Promise<string> {
    return '';
  }

  static async writeText(path: string, content: string): Promise<void> {
  }
}
