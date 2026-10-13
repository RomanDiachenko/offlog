import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downscaleImage } from '../src/lib/shared/taskHelpers';

// jsdom decodes no images: the bitmap's size and the canvas's encoder are faked,
// and the encoder records which format it was asked for.
let size = { width: 800, height: 600 };
let encodedAs = '';
beforeEach(() => {
  encodedAs = '';
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ ...size, close() {} })));
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string) {
    encodedAs = type ?? '';
    cb(new Blob(['x'], { type }));
  };
});
afterEach(() => vi.unstubAllGlobals());

describe('downscaleImage', () => {
  it('re-encodes a photo as JPEG', async () => {
    size = { width: 4000, height: 3000 };
    const out = await downscaleImage(new File(['p'], 'IMG_1.webp', { type: 'image/webp' }));
    expect(encodedAs).toBe('image/jpeg');
    expect(out.filename).toBe('IMG_1.jpg');
  });

  it('keeps a large PNG as PNG, shrunk', async () => {
    size = { width: 3200, height: 1800 };
    const out = await downscaleImage(new File(['p'], 'shot.png', { type: 'image/png' }));
    expect(encodedAs).toBe('image/png');
    expect(out.filename).toBe('shot.png');
  });

  it('keeps a small PNG byte for byte', async () => {
    size = { width: 400, height: 300 };
    const file = new File(['exact-bytes'], 'icon.png', { type: 'image/png' });
    const out = await downscaleImage(file);
    expect(encodedAs).toBe('');
    expect(out).toMatchObject({ filename: 'icon.png', size: file.size });
    expect(atob(out.base64Data)).toBe('exact-bytes');
  });
});
