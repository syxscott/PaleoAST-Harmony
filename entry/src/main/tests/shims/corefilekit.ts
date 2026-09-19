/**
 * Node shim for '@kit.CoreFileKit'.
 *
 * The test harness needs to import modules that touch the file API (the
 * controllers do), but no test should actually hit the filesystem. Any call
 * that would do real I/O throws a clear error instead of silently misbehaving,
 * so in-memory paths stay testable and file paths are obviously out of scope.
 */

function unavailable(name: string): never {
  throw new Error(`@kit.CoreFileKit shim: ${name} is not available under the node test harness`);
}

export const fs = {
  OpenMode: { READ_ONLY: 0, READ_WRITE: 2, CREATE: 64, TRUNC: 512 },
  openSync: (path: string): never => unavailable(`fs.openSync(${path})`),
  writeSync: (): never => unavailable('fs.writeSync'),
  readSync: (): never => unavailable('fs.readSync'),
  closeSync: (): never => unavailable('fs.closeSync'),
  accessSync: (): never => unavailable('fs.accessSync'),
  statSync: (): never => unavailable('fs.statSync'),
  mkdirSync: (): never => unavailable('fs.mkdirSync'),
  unlinkSync: (): never => unavailable('fs.unlinkSync'),
  listFileSync: (): never => unavailable('fs.listFileSync'),
  readTextSync: (): never => unavailable('fs.readTextSync'),
};

export default { fs };
