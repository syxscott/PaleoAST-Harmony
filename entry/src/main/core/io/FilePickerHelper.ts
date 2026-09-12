/**
 * FilePickerHelper - HarmonyOS file picker integration.
 * Uses the system document picker (@kit.CoreFileKit picker) and fs for
 * sandbox-safe import/export. Real implementations — no stubs.
 */
import { picker, fs } from '@kit.CoreFileKit';
import { FileManager } from './FileManager';

export class FilePickerHelper {
  /**
   * Open the system document picker and return the selected file URI
   * (null when the user cancels).
   */
  static async pickFile(): Promise<string | null> {
    const options = new picker.DocumentSelectOptions();
    const documentPicker = new picker.DocumentViewPicker();
    try {
      const uris = await documentPicker.select(options);
      return uris.length > 0 ? uris[0] : null;
    } catch (e) {
      return null; // user cancel or picker error
    }
  }

  /**
   * Open the system save dialog, write the content to the chosen location
   * and return the target URI (null when the user cancels).
   */
  static async saveFile(content: string, suggestedName: string): Promise<string | null> {
    const options = new picker.DocumentSaveOptions();
    options.newFileNames = [suggestedName];
    const pickerObj = new picker.DocumentViewPicker();
    try {
      const uris = await pickerObj.save(options);
      if (uris && uris.length > 0) {
        const file = fs.openSync(uris[0], fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
        try {
          fs.writeSync(file.fd, content);
        } finally {
          fs.closeSync(file.fd);
        }
        return uris[0];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /** Read file content from a sandbox path (delegates to FileManager). */
  static async readFile(path: string): Promise<string> {
    return await FileManager.readText(path);
  }

  static getFileType(path: string): string {
    return FileManager.getFileType(path);
  }

  static canHandle(path: string): boolean {
    return FileManager.isTextFile(path);
  }
}
