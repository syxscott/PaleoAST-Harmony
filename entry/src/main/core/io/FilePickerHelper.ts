/**
 * FilePickerHelper — HarmonyOS file picker integration.
 * Replaces direct file paths with sandbox-safe picker dialogs.
 */
import { FileManager } from './FileManager';

export class FilePickerHelper {
  static async pickFile(): Promise<string | null> {
    // HarmonyOS: import picker from '@ohos.file.picker';
    //   const documentSelectOptions = new picker.DocumentSelectOptions();
    //   const documentPicker = new picker.DocumentViewPicker();
    //   const uris = await documentPicker.select(documentSelectOptions);
    //   return uris[0];
    // For now return a placeholder path
    return null;
  }

  static async pickMultipleFiles(): Promise<string[]> {
    // HarmonyOS:
    //   const options = new picker.DocumentSelectOptions();
    //   options.maxSelectNumber = 10;
    //   const picker = new picker.DocumentViewPicker();
    //   return await picker.select(options);
    return [];
  }

  static async saveFile(content: string, suggestedName: string): Promise<string | null> {
    // HarmonyOS:
    //   const options = new picker.DocumentSaveOptions();
    //   options.newFileNames = [suggestedName];
    //   const picker = new picker.DocumentViewPicker();
    //   const uris = await picker.save(options);
    //   if (uris && uris.length > 0) {
    //     const fs = await import('@ohos.file.fs');
    //     const fd = fs.openSync(uris[0], fs.OpenMode.READ_WRITE);
    //     fs.writeSync(fd.fd, content);
    //     fs.closeSync(fd);
    //     return uris[0];
    //   }
    return null;
  }

  static async readFile(path: string): Promise<string> {
    // HarmonyOS:
    //   const fs = await import('@ohos.file.fs');
    //   const fd = fs.openSync(path, fs.OpenMode.READ_ONLY);
    //   const stat = fs.statSync(fd.fd);
    //   const buffer = new ArrayBuffer(stat.size);
    //   fs.readSync(fd.fd, buffer);
    //   fs.closeSync(fd);
    //   return new TextDecoder('utf-8').decode(buffer);
    return await FileManager.readText(path);
  }

  static getFileType(path: string): string {
    return FileManager.getFileType(path);
  }

  static canHandle(path: string): boolean {
    return FileManager.isTextFile(path);
  }
}
