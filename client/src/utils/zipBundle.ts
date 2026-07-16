// Browser-side zip builder for the "download sprite bundle" flow.
//
// We don't pull in JSZip / fflate to keep the bundle lean and avoid
// a new dependency. The output is a valid Store-only (method 0) zip
// — uncompressed — which every modern OS can open. Each entry is
// written with its CRC-32, name, raw bytes, and a central directory
// record followed by the EOCD record.
//
// Usage:
//   const blob = createZip([{ name: "sprite.svg", data: "..." }, ...]);
//   triggerBrowserDownload(blob, "sprite-bundle.zip");
//
// All data is handled as Uint8Array; strings are UTF-8 encoded.

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function dosDateTime(now = new Date()): { date: number; time: number } {
  // MS-DOS packed date/time. Seconds are 2-second resolution, so we
  // floor them to keep round-tripping tidy.
  const date =
    ((now.getFullYear() - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();
  const time =
    (now.getHours() << 11) |
    (now.getMinutes() << 5) |
    Math.floor(now.getSeconds() / 2);
  return { date: date & 0xffff, time: time & 0xffff };
}

export type ZipEntry = {
  name: string;
  data: string | Uint8Array;
};

type CompiledEntry = {
  name: Uint8Array;
  bytes: Uint8Array;
  crc: number;
  localHeaderOffset: number;
  date: number;
  time: number;
};

/**
 * Build a Store-method zip archive from the given entries. Returns a
 * Blob with mime type `application/zip`.
 */
export function createZip(entries: ZipEntry[]): Blob {
  const { date, time } = dosDateTime();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const compiled: CompiledEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = utf8(entry.name);
    const dataBytes =
      typeof entry.data === "string" ? utf8(entry.data) : entry.data;
    const crc = crc32(dataBytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true); // local file header signature
    view.setUint16(4, 20, true); // version needed (2.0)
    view.setUint16(6, 0, true); // general purpose bit flag
    view.setUint16(8, 0, true); // compression method (0 = store)
    view.setUint16(10, time, true);
    view.setUint16(12, date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, dataBytes.length, true); // compressed size
    view.setUint32(22, dataBytes.length, true); // uncompressed size
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true); // extra field length
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    compiled.push({
      name: nameBytes,
      bytes: dataBytes,
      crc,
      localHeaderOffset: offset,
      date,
      time,
    });
    offset += localHeader.length + dataBytes.length;
  }

  const centralStart = offset;
  const centralBytes = concat(centralParts);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, compiled.length, true);
  ev.setUint16(10, compiled.length, true);
  ev.setUint32(12, centralBytes.length, true);
  ev.setUint32(16, centralStart, true);
  ev.setUint16(20, 0, true);

  const out = concat([...localParts, centralBytes, eocd]);
  // Copy into a plain ArrayBuffer so TypeScript narrows BlobPart to
  // ArrayBufferView<ArrayBuffer> under the latest DOM lib types.
  const buf = new ArrayBuffer(out.byteLength);
  new Uint8Array(buf).set(out);
  return new Blob([buf], { type: "application/zip" });
}

/**
 * Trigger a browser download for the given blob with the supplied
 * filename. Works in Chromium, Firefox, and Safari.
 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
