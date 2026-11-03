import { err, ok, type Result } from "@fresnel/contracts";
import type { SettingKey } from "@fresnel/contracts/settings";

// 샌드박스 목록 편집기(L4.desktop-ux §6.13)의 순수 모델. 두 목록을 다룬다: 쓰기 경로(`l0.sandbox.writeRoots.extra`)와
// 차단 도메인(`l0.sandbox.network.blockedDomains`). 차단이 먼저다. 보호 경로 안의 쓰기 경로는 지워지고(L0.sandbox §3.4),
// 차단 도메인은 허용 목록보다 먼저 검사한다(L0.sandbox §3.2). 화면은 이 순서를 "차단 우선" 문장으로 말한다.

export type SandboxListKind = "paths" | "domains";

const KIND_BY_KEY: ReadonlyMap<SettingKey, SandboxListKind> = new Map<SettingKey, SandboxListKind>([
  ["l0.sandbox.writeRoots.extra", "paths"],
  ["l0.sandbox.network.blockedDomains", "domains"],
]);

/** 키로 목록 종류를 고른다. 두 목록이 아니면 `null`이다 */
export function sandboxListKindOf(key: SettingKey): SandboxListKind | null {
  return KIND_BY_KEY.get(key) ?? null;
}

export type PathIssue = "empty" | "control" | "relative" | "traversal";
export type DomainIssue = "empty" | "format";
export type EntryIssue = PathIssue | DomainIssue | "duplicate";

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function hasControlChar(text: string): boolean {
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** 쓰기 경로 형식. 절대 경로나 `~/`로 시작해야 하고, `..` 마디와 보이지 않는 문자는 쓸 수 없다 */
export function checkPath(text: string): Result<string, PathIssue> {
  const path = text.trim();
  if (path === "") return err("empty");
  if (hasControlChar(path)) return err("control");
  if (!path.startsWith("/") && !path.startsWith("~/")) return err("relative");
  if (path.split("/").includes("..")) return err("traversal");
  return ok(path);
}

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_MAX = 253;

/** 도메인 형식. 소문자로 바꾼다. `*.`으로 시작할 수 있고, 마디마다 글자와 숫자와 줄표만 쓴다 */
export function checkDomain(text: string): Result<string, DomainIssue> {
  const domain = text.trim().toLowerCase();
  if (domain === "") return err("empty");
  const body = domain.startsWith("*.") ? domain.slice(2) : domain;
  if (domain.length > DOMAIN_MAX || !body.split(".").every((label) => DOMAIN_LABEL.test(label))) {
    return err("format");
  }
  return ok(domain);
}

/** 목록 종류에 맞는 형식 검사 */
export function checkEntry(
  kind: SandboxListKind,
  text: string,
): Result<string, PathIssue | DomainIssue> {
  return kind === "paths" ? checkPath(text) : checkDomain(text);
}

/** 검사를 통과한 값을 목록 끝에 넣는다. 이미 있으면 `duplicate`다 */
export function addEntry(
  kind: SandboxListKind,
  list: readonly string[],
  text: string,
): Result<readonly string[], EntryIssue> {
  const checked = checkEntry(kind, text);
  if (!checked.ok) return err(checked.error);
  if (list.includes(checked.value)) return err("duplicate");
  return ok([...list, checked.value]);
}

export function withoutEntry(list: readonly string[], index: number): readonly string[] {
  return list.toSpliced(index, 1);
}

/** 값을 글 목록으로 읽는다. 글이 아닌 원소가 있으면 `null`이다 */
export function textListOf(value: unknown): readonly string[] | null {
  if (!isList(value)) return null;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    items.push(item);
  }
  return items;
}
