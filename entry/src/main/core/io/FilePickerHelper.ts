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
    return FilePickerHelper.writeViaPicker(
      (fd: number) => { fs.writeSync(fd, content); },
      suggestedName,
    );
  }

  /**
   * Binary counterpart of saveFile, for figure exports (PNG bytes).
   *
   * saveFile takes a string, and fs.writeSync(fd, string) writes text, so PNG
   * data could not go through it. Accepts either an ArrayBuffer or a typed
   * array so the caller can hand over whatever the image packer returned.
   */
  static async saveBinary(bytes: ArrayBuffer | Uint8Array, suggestedName: string): Promise<string | null> {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return FilePickerHelper.writeViaPicker(
      (fd: number) => { fs.writeSync(fd, view.buffer); },
      suggestedName,
    );
  }

  /** Shared picker + write sequence, so both save paths behave identically. */
  private static async writeViaPicker(
    write: (fd: number) => void,
    suggestedName: string,
  ): Promise<string | null> {
    const options = new picker.DocumentSaveOptions();
    options.newFileNames = [suggestedName];
    const pickerObj = new picker.DocumentViewPicker();
    try {
      const uris = await pickerObj.save(options);
      if (uris && uris.length > 0) {
        const file = fs.openSync(uris[0], fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
        try {
          write(file.fd);
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
