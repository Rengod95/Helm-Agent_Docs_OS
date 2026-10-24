import type { EventKind } from "../kind-names.ts";
import type { TSchema } from "typebox";

export interface CatalogEntry {
  kind: EventKind;
  /** 현재 버전 */
  version: number;
  durable: boolean;
  /** 현재 버전 payload 스키마 */
  payload: TSchema;
  /** 없앤 kind는 카탈로그에 남긴다 */
  retired?: true;
}
