// Minimal ambient types for heic-convert (no bundled or @types declarations).
// Used to decode HEVC-coded HEIC, which sharp's prebuilt libvips cannot.
declare module 'heic-convert' {
  interface ConvertOptions {
    buffer: Buffer | ArrayBuffer | Uint8Array;
    format: 'JPEG' | 'PNG';
    /** 0..1, JPEG only. */
    quality?: number;
  }
  function convert(options: ConvertOptions): Promise<ArrayBuffer>;
  export = convert;
}
