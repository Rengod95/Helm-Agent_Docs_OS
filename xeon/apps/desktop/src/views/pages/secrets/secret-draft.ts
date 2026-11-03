import { err, ok, parse, type Result } from "@fresnel/contracts";
import {
  SecretNameSchema,
  type SecretApproval,
  type SecretName,
} from "@fresnel/contracts/capabilities";
import type { SecretListEntry, WireParams } from "@fresnel/contracts/wire";

// 시크릿 화면의 입력 검사(순수 함수). 이름 규칙은 계약의 `SecretNameSchema`가 정하고, 메타 범위는 `secret.meta`의 제한을 따른다.
// 검사가 틀리면 문제의 칸을 값으로 돌려준다. 문장은 화면이 메시지 키로 만든다.

/** 메타 편집 칸. 숫자 칸도 입력 그대로 문자열로 든다(빈 칸은 "바꾸지 않음"이다) */
export interface MetaDraft {
  readonly desc: string;
  /** 쉼표나 공백으로 나눈 호스트 목록 */
  readonly hosts: string;
  /** `YYYY-MM-DD`. 비우면 만료가 없다 */
  readonly expiresAt: string;
  readonly approval: SecretApproval;
  readonly ttlSeconds: string;
  readonly maxUses: string;
}

/** 메타 입력 칸의 문제. 메시지 키의 뒷부분으로 쓴다 */
export type MetaProblem = "desc" | "hosts" | "expiresAt" | "ttlSeconds" | "maxUses";

const DESC_MAX = 500;
const HOSTS_MAX_COUNT = 256;
const HOST_MAX_LENGTH = 253;
const TTL_MAX = 86_400;
const MAX_USES_MAX = 100_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER_PATTERN = /^\d+$/;

/** 편집 칸의 첫 값. 메타가 없으면 빈 칸이다 */
export function draftOf(meta: SecretListEntry["meta"]): MetaDraft {
  return {
    desc: meta?.desc ?? "",
    hosts: meta?.use.hosts.join(", ") ?? "",
    expiresAt: meta?.expiresAt ?? "",
    approval: meta?.approval ?? "none",
    ttlSeconds: meta === undefined ? "" : String(meta.ttlSeconds),
    maxUses: meta === undefined ? "" : String(meta.maxUses),
  };
}

/** 새 시크릿 이름. 계약의 규칙을 그대로 쓴다 */
export function entryNameOf(text: string): Result<SecretName, "name"> {
  const parsed = parse(SecretNameSchema, text.trim());
  return parsed.ok ? ok(parsed.value) : err("name");
}

function hostsOf(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((host) => host.trim())
    .filter((host) => host !== "");
}

/** 정수 칸. 빈 칸은 `undefined`(바꾸지 않음)이고, 틀리면 `null`이다 */
function integerOf(text: string, max: number): number | undefined | null {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  if (!INTEGER_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= max ? value : null;
}

/**
 * 편집 칸을 `secret.meta` 인자로 바꾼다. `use`는 기존 메타가 있을 때만 보낸다(모드와 도구는 그대로 둔다).
 * 틀린 칸이 있으면 첫 문제만 돌려준다.
 */
export function metaParamsOf(
  name: SecretName,
  draft: MetaDraft,
  meta: SecretListEntry["meta"],
): Result<WireParams<"secret.meta">, MetaProblem> {
  const desc = draft.desc.trim();
  if (desc === "" || desc.length > DESC_MAX) return err("desc");

  const hosts = hostsOf(draft.hosts);
  if (hosts.length > HOSTS_MAX_COUNT || hosts.some((host) => host.length > HOST_MAX_LENGTH)) {
    return err("hosts");
  }

  const expires = draft.expiresAt.trim();
  if (expires !== "" && (!DATE_PATTERN.test(expires) || Number.isNaN(Date.parse(expires)))) {
    return err("expiresAt");
  }

  const ttl = integerOf(draft.ttlSeconds, TTL_MAX);
  if (ttl === null) return err("ttlSeconds");

  const maxUses = integerOf(draft.maxUses, MAX_USES_MAX);
  if (maxUses === null) return err("maxUses");

  return ok({
    name,
    desc,
    expiresAt: expires === "" ? null : expires,
    approval: draft.approval,
    ...(meta === undefined ? {} : { use: { ...meta.use, hosts } }),
    ...(ttl === undefined ? {} : { ttlSeconds: ttl }),
    ...(maxUses === undefined ? {} : { maxUses }),
  });
}
