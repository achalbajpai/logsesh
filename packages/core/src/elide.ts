export const ELIDE_BASE64_MIN_CHARS = 4096;
export const BINARY_OMITTED_NOTE = "[binary content omitted]";

const DATA_URL_BASE64 = /^data:([^;,]+)?;base64,([\s\S]+)$/;
const BASE64_LIKE = /^[A-Za-z0-9+/]+=*$/;

export type ElidedImage = {
  kind: "image";
  mediaType?: string;
  bytes: number;
  note: string;
};

export function elideBinaryString(text: string): ElidedImage | undefined {
  const dataUrl = DATA_URL_BASE64.exec(text);
  if (dataUrl) {
    const mediaType = dataUrl[1];
    const payload = dataUrl[2] ?? "";
    const image: ElidedImage = {
      kind: "image",
      bytes: Buffer.from(payload, "base64").byteLength,
      note: BINARY_OMITTED_NOTE,
    };
    if (mediaType) image.mediaType = mediaType;
    return image;
  }

  if (text.length >= ELIDE_BASE64_MIN_CHARS && BASE64_LIKE.test(text)) {
    return {
      kind: "image",
      bytes: Buffer.from(text, "base64").byteLength,
      note: BINARY_OMITTED_NOTE,
    };
  }

  return undefined;
}

export function elideStoredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return elideBinaryString(value) ?? value;
}
