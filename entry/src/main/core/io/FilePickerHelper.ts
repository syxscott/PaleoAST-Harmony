/**
 * FilePickerHelper - HarmonyOS file picker integration.
 * Uses the system document picker (@kit.CoreFileKit picker) and fs for
 * sandbox-safe import/export. Real implementations — no stubs.
 */
import { fs } from '@kit.CoreFileKit';
import { FileManager } from './FileManager';

/**
 * HarmonyOS business error code for "the user dismissed the picker"
 * (13900012 — the document picker's cancel code).
 */
const PICKER_CANCEL_CODE = 13900012;

/** Describe a thrown value for a user-facing message. */
function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  const err = e as { code?: number; message?: string };
  const msg = typeof err?.message === 'string' ? err.message : String(e);
  const code = typeof err?.code === 'number' ? err.code : undefined;
  return code !== undefined ? `(${code}) ${msg}` : msg;
}

export class FilePickerHelper {
  /**
   * Open the system document picker and return the selected file URI
   * (null when the user cancels).
   *
   * A picker that fails for any other reason now throws instead of being
   * reported as a cancel — "you cancelled" and "the dialog broke" are
   * different problems and the user must be able to tell them apart.
   */
  static async pickFile(): Promise<string | null> {
    // The picker is imported dynamically: a static `import { picker }` from
    // '@kit.CoreFileKit' makes this module impossible to instantiate
    // outside the device (the node test shim has no `picker` export, and the
    // module graph then fails with "does not provide an export named
    // 'picker'"), so none of the cancel/failure behaviour below could be
    // tested at all. The dynamic import is the pattern the rest of core/
    // uses for kit modules (see ProcessPool / TaskScheduler).
    const { picker } = await import('@kit.CoreFileKit');
    const options = new picker.DocumentSelectOptions();
    const documentPicker = new picker.DocumentViewPicker();
    try {
      const uris = await documentPicker.select(options);
      return uris.length > 0 ? uris[0] : null;
    } catch (e) {
      if (FilePickerHelper.isUserCancel(e)) return null;
      throw new Error('File picker failed: ' + describeError(e));
    }
  }

  /**
   * Open the system save dialog, write the content to the chosen location
   * and return the target URI.
   *
   * The result is `null` ONLY when the user cancelled. A failed write
   * rejects the promise: it used to be folded into the same `null`, so the
   * only thing the caller could say was "export cancelled" while nothing had
   * been written at all — the report was lost and the user was told they had
   * cancelled themselves.
   */
  static async saveFile(content: string, suggestedName: string): Promise<string | null> {
    return FilePickerHelper.saveVia(
      () => FilePickerHelper.pickSaveTarget(suggestedName),
      (fd: number) => { fs.writeSync(fd, content); },
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
    // `new Uint8Array(arrayBuffer)` is a VIEW, not a copy, and a subarray shares
    // its parent's buffer -- so `view.buffer` can be larger than the data. The
    // old code wrote that whole buffer, appending the trailing bytes to the
    // file: a 3-byte PNG taken as `packed.subarray(0, 3)` out of an 8-byte
    // buffer wrote 8 bytes. Copy into an exactly-sized buffer instead of
    // relying on an offset/length overload of fs.writeSync.
    const exact = new Uint8Array(view.byteLength);
    exact.set(view);
    return FilePickerHelper.saveVia(
      () => FilePickerHelper.pickSaveTarget(suggestedName),
      (fd: number) => { fs.writeSync(fd, exact.buffer); },
    );
  }

  /**
   * The shared "pick a target, then write to it" sequence.
   *
   * `pick` resolves to the target URI, or to null when the user cancelled.
   * `write` receives the file descriptor of that target. Any error raised by
   * the write (no space left, read-only directory, denied permission)
   * propagates to the caller — it is a FAILURE and must never be reported as
   * a cancel.
   *
   * Both save paths go through here, and so do the tests, so the
   * cancel/failure distinction is exercised by one piece of code.
   */
  static async saveVia(
    pick: () => Promise<string | null>,
    write: (fd: number) => void,
  ): Promise<string | null> {
    const uri = await pick();
    if (uri === null || uri === undefined) return null;   // user cancelled
    FilePickerHelper.writeToUri(uri, write);
    return uri;
  }

  /**
   * Write to a URI the caller already has.
   *
   * Errors from openSync/writeSync propagate — a half-written or missing
   * file is a failure, not a cancellation.
   */
  static writeToUri(uri: string, write: (fd: number) => void): void {
    const file = fs.openSync(uri, fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    try {
      write(file.fd);
    } finally {
      fs.closeSync(file.fd);
    }
  }

  /**
   * Ask the system where to save.
   *
   * Returns null when the user cancelled; any other picker failure is
   * rethrown, because "the save dialog broke" is not "the user cancelled".
   */
  private static async pickSaveTarget(suggestedName: string): Promise<string | null> {
    const { picker } = await import('@kit.CoreFileKit');
    const options = new picker.DocumentSaveOptions();
    options.newFileNames = [suggestedName];
    const pickerObj = new picker.DocumentViewPicker();
    try {
      const uris = await pickerObj.save(options);
      if (uris && uris.length > 0) return uris[0];
      return null;
    } catch (e) {
      if (FilePickerHelper.isUserCancel(e)) return null;
      throw new Error('Save dialog failed: ' + describeError(e));
    }
  }

  /**
   * True when the error means "the user dismissed the dialog".
   *
   * The HarmonyOS picker reports a dismissal with business error code
   * 13900012; the message is checked as well because the code is not
   * available on every platform version.
   */
  static isUserCancel(e: unknown): boolean {
    const err = e as { code?: number; message?: string };
    const code = typeof err?.code === 'number' ? err.code : -1;
    if (code === PICKER_CANCEL_CODE) return true;
    const msg = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
    return msg.indexOf('cancel') >= 0 || msg.indexOf('dismiss') >= 0;
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
