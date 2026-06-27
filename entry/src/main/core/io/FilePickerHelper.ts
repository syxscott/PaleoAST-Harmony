/**
 * FilePickerHelper - HarmonyOS file picker integration.
 * Uses @ohos.file.picker and @ohos.file.fs for sandbox-safe I/O.
 * Import statements are device-only (commented for compilation).
 */
import { FileManager } from './FileManager';

export class FilePickerHelper {
  /**
   * Open file picker dialog for import.
   * On device: uncomment the picker import and implementation.
   */
  static async pickFile(): Promise<string | null> {
    // import picker from '@ohos.file.picker';
    // const options = new picker.DocumentSelectOptions();
    // const documentPicker = new picker.DocumentViewPicker();
    // const uris = await documentPicker.select(options);
    // return uris.length > 0 ? uris[0] : null;
    return null;
  }

  /**
   * Save file via picker dialog.
   */
  static async saveFile(content: string, suggestedName: string): Promise<string | null> {
    // import picker from '@ohos.file.picker';
    // import fs from '@ohos.file.fs';
    // const options = new picker.DocumentSaveOptions();
    // options.newFileNames = [suggestedName];
    // const pickerObj = new picker.DocumentViewPicker();
    // const uris = await pickerObj.save(options);
    // if (uris && uris.length > 0) {
    //   const fd = fs.openSync(uris[0], fs.OpenMode.READ_WRITE);
    //   fs.writeSync(fd.fd, content);
    //   fs.closeSync(fd);
    //   return uris[0];
    // }
    return null;
  }

  /**
   * Read file content from sandbox path.
   */
  static async readFile(path: string): Promise<string> {
    // import fs from '@ohos.file.fs';
    // const fd = fs.openSync(path, fs.OpenMode.READ_ONLY);
    // const stat = fs.statSync(fd.fd);
    // const buffer = new ArrayBuffer(stat.size);
    // fs.readSync(fd.fd, buffer);
    // fs.closeSync(fd);
    // return new TextDecoder('utf-8').decode(buffer);
    return await FileManager.readText(path);
  }

  static getFileType(path: string): string {
    return FileManager.getFileType(path);
  }

  static canHandle(path: string): boolean {
    return FileManager.isTextFile(path);
  }
}
