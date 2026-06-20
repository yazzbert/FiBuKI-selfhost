// Minimal ambient typings for the `qrcode` package (v1.5).
// Only declares the surface the app actually uses, avoids adding @types/qrcode.

declare module "qrcode" {
  export interface QRCodeToDataURLOptions {
    margin?: number;
    width?: number;
    type?: "image/png" | "image/jpeg" | "image/webp";
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    color?: { dark?: string; light?: string };
  }

  export function toDataURL(
    text: string,
    options?: QRCodeToDataURLOptions
  ): Promise<string>;

  const _default: {
    toDataURL: typeof toDataURL;
  };
  export default _default;
}
