import { Type, type TLiteral, type TUnion } from "typebox";

// 키 등록 실패의 종류 코드 어휘(L4.cli.spec §4.7, L4.desktop.spec §4.14.1 [결정: 2026-11-12 사용자]).
// 엔진(`fresnel secret`)은 실패 문장 뒤에 `FAILURE_CODE_PREFIX` 줄을 한 줄 쓰고, 셸은 그 줄로 원인을 나누며, 화면은 코드마다 문장을 고른다.
// 실패 문장을 맞춰 보지 않는다. 철자는 고정이다. 값, 경로, 외부 도구의 출력은 이 줄에 싣지 않는다.

/** 종류 코드 줄의 머리말. 줄은 `<머리말><코드>`다 */
export const FAILURE_CODE_PREFIX = "fresnel-code: ";

export const FAILURE_KINDS = [
  "key_store",
  "key_missing",
  "key_file",
  "key_fallback_unconfirmed",
  "service_local_only",
  "already_exists",
  "not_found",
  "value_too_short",
  "value_empty",
  "cancelled",
  "sops_missing",
  "sops_version",
  "age_missing",
  "provider_unavailable",
  "decrypt_failed",
  "read_only_provider",
  "write_failed",
  "store_busy",
  "service_unreachable",
  "unknown",
] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

export const FailureKindSchema: TUnion<TLiteral<FailureKind>[]> = Type.Union(
  FAILURE_KINDS.map((kind) => Type.Literal(kind)),
);

/** 글이 어휘의 코드인가. 모르는 코드는 `unknown`으로 다룬다 */
export function isFailureKind(value: string): value is FailureKind {
  return FAILURE_KINDS.some((kind) => kind === value);
}
