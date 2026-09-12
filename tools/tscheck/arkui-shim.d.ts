/**
 * Minimal @kit.ArkUI shim for plain-tsc type checking of core/*.ts files.
 * Only the symbols core/ actually imports are declared; decorators are
 * declared as no-op class decorators.
 */
declare module '@kit.ArkTS' {
  export namespace taskpool {
    export function execute(func: object, ...args: object[]): Promise<object>;
    export interface Task { }
  }
}

declare module '@kit.ArkUI' {
  export function Observed(target: object): void;
  export function Track(target: object, propertyKey: string): void;
  export interface Context { [k: string]: object }
}

declare module '@kit.CoreFileKit' {
  export interface File {
    fd: number;
  }
  export namespace fs {
    export const OpenMode: { READ_ONLY: number; READ_WRITE: number; CREATE: number; TRUNC: number; APPEND: number };
    export function openSync(path: string, mode: number): File;
    export function writeSync(fd: number, content: string): void;
    export function closeSync(fd: number): void;
    export function readTextSync(filePath: string, options?: object): string;
    export function accessSync(path: string): void;
    export function statSync(path: string): { size: number };
  }
  export namespace picker {
    export class DocumentSelectOptions {
      maxSelectNumber?: number;
      fileSuffixFilters?: Array<string>;
    }
    export class DocumentSaveOptions {
      newFileNames?: Array<string>;
    }
    export class DocumentViewPicker {
      select(options?: DocumentSelectOptions): Promise<Array<string>>;
      save(options?: DocumentSaveOptions): Promise<Array<string>>;
    }
  }
}

// Environment globals available in ArkTS runtime (absent from ES2020 lib).
declare const console: {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};
declare function setTimeout(cb: (...args: unknown[]) => void, ms?: number): number;
declare function clearTimeout(id: number): void;
declare function setInterval(cb: (...args: unknown[]) => void, ms?: number): number;
declare function clearInterval(id: number): void;
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  decode(input?: Uint8Array): string;
}
