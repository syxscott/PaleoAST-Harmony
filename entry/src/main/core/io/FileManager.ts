/**
 * File manager ¡ª replaces parsers I/O utilities.
 * Abstraction over HarmonyOS file system APIs.
 */

export class FileManager {
  static getExtension(path: string): string { return path.split('.').pop()?.toLowerCase() || ''; }

  static isTextFile(path: string): boolean {
    return ['csv','tsv','txt','tps','nxs','nex','tre','newick','nwck','dat','json'].includes(FileManager.getExtension(path));
  }

  static getFileType(path: string): string {
    const ext = FileManager.getExtension(path);
    const map: Record<string, string> = {
      csv: 'csv', tsv: 'csv', txt: 'text', tps: 'tps',
      nxs: 'nexus', nex: 'nexus', tre: 'newick', newick: 'newick',
      nwck: 'newick', dat: 'dat', xlsx: 'excel', xls: 'excel',
    };
    return map[ext] || 'unknown';
  }

  static getBaseName(path: string): string { return path.split('/').pop()?.split('').pop() || path; }
  static getDirName(path: string): string { return path.substring(0, path.lastIndexOf('/')); }

  static joinPath(...parts: string[]): string {
    return parts.join('/').replace(/\/+/g, '/');
  }
}
