/**
 * File Manager - HarmonyOS file system abstraction.
 * readText/writeText/appendText/exists use @kit.CoreFileKit (fs) — real I/O.
 */
import { fs } from '@kit.CoreFileKit';

export class FileManager {
  static getExtension(path: string): string {
    return path.split('.').pop()?.toLowerCase() || '';
  }

  static getBaseName(path: string): string {
    return path.split('/').pop() || path;
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

  /** Read a whole text file from the app sandbox. */
  static async readText(path: string): Promise<string> {
    return fs.readTextSync(path);
  }

  /** Write text to a file in the app sandbox (creates or truncates). */
  static async writeText(path: string, content: string): Promise<void> {
    const file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
    try {
      fs.writeSync(file.fd, content);
    } finally {
      fs.closeSync(file.fd);
    }
  }

  /** Append text to a file in the app sandbox (creates if missing). */
  static async appendText(path: string, content: string): Promise<void> {
    const file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.APPEND);
    try {
      fs.writeSync(file.fd, content);
    } finally {
      fs.closeSync(file.fd);
    }
  }

  /** Check whether a path exists. */
  static async exists(path: string): Promise<boolean> {
    try {
      fs.accessSync(path);
      return true;
    } catch (e) {
      return false;
    }
  }
}
