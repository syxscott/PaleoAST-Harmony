/**
 * Regression test: saveBinary wrote the whole underlying buffer
 * (2026-09-27, seventh pass).
 *
 * `new Uint8Array(arrayBuffer)` is a VIEW, not a copy, and a subarray shares its
 * parent's buffer. The old code did `fs.writeSync(fd, view.buffer)`, so a payload
 * that happened to be a view into a larger buffer had its trailing bytes
 * appended to the file. Measured on a 3-byte view of an 8-byte buffer: the old
 * code wrote 8 bytes, not 3.
 *
 * The current caller (PlotCanvas -> `image.createImagePacker().pack`) returns a
 * freshly allocated, exactly-sized ArrayBuffer, so this was not reachable through
 * the UI -- but `saveBinary`'s own contract says "hand over whatever the image
 * packer returned", and a packer returning a subarray is entirely ordinary. The
 * fix copies into an exactly-sized buffer rather than relying on an
 * offset/length overload of fs.writeSync that could not be verified without the
 * SDK.
 *
 * FilePickerHelper imports @kit.CoreFileKit, so it cannot be loaded in the Node
 * harness. The test therefore pins the two properties of the source that make the
 * behaviour correct, and re-derives the arithmetic it depends on.
 */
import { describe, it, expect } from './runner.ts';
import { readFileSync } from 'node:fs';

const SRC = 'entry/src/main/core/io/FilePickerHelper.ts';
const src = readFileSync(SRC, 'utf-8');

describe('audit: saveBinary wrote the whole buffer, not the view', () => {
  it('the payload is copied into an exactly-sized buffer before writing', () => {
    expect(src.includes('const exact = new Uint8Array(view.byteLength);')).toBe(true);
    expect(src.includes('exact.set(view);')).toBe(true);
    expect(src.includes('fs.writeSync(fd, exact.buffer);')).toBe(true);
  });

  it('view.buffer is no longer handed to writeSync', () => {
    // Before: `fs.writeSync(fd, view.buffer)`.
    expect(src.includes('fs.writeSync(fd, view.buffer)')).toBe(false);
  });

  it('a subarray view of a larger buffer must not widen the file', () => {
    // The arithmetic the fix relies on, spelled out so the test states the
    // defect rather than restating the implementation.
    const packed = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const view = packed.subarray(0, 3);

    // The old expression wrote the whole 8-byte buffer for 3 bytes of data.
    expect(view.byteLength).toBe(3);
    expect(view.buffer.byteLength).toBe(8);
    expect(view.buffer.byteLength === view.byteLength ? 'same size' : 'buffer is wider').toBe('buffer is wider');

    // The fix produces a buffer that matches the view exactly.
    const exact = new Uint8Array(view.byteLength);
    exact.set(view);
    expect(exact.buffer.byteLength).toBe(view.byteLength);
    expect(Array.from(exact).join(',')).toBe(Array.from(view).join(','));

    // And a whole, exactly-sized ArrayBuffer -- what the current caller passes --
    // is unaffected either way.
    const fresh = new Uint8Array([9, 9, 9]).buffer;
    expect(new Uint8Array(fresh).buffer.byteLength).toBe(3);
  });
});
