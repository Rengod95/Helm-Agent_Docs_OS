// XEON-PATCH: P12
import type { ImageLimits } from "@xeon/contracts/capabilities";

export const DEFAULT_IMAGE_LIMITS: ImageLimits = {
  maxWidth: 2000,
  maxHeight: 2000,
  maxBytes: 4.5 * 1024 * 1024,
};

/** Formats every provider takes inline; others, such as BMP, need converting. */
export const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** The length of the base64 of `byteLength` bytes. */
export function base64Length(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4;
}
