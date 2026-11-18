import { randomUUID } from "node:crypto";
import { assertNever, eachAsync, err, ok, type Result } from "@fresnel/contracts";
import type { FileBefore } from "@fresnel/contracts/records";
import type { CancelScope, WorkspaceEnv } from "@fresnel/contracts/services";
import { sha256Bytes } from "./hash.ts";

// 되감기가 파일 시스템에 손대는 자리. 쓰기는 기존 `atomicWrite`를 쓰지 않는다. 그 함수는 문자열만 받아
// UTF-8이 아닌 바이트를 그대로 복원할 수 없다. 같은 절차(같은 디렉터리의 임시 파일, 디스크 반영, 이름 바꾸기)를 바이트로 한다.
// 부모 디렉터리는 `writeFile`이 `mkdir -p`로 만들므로 따로 만들지 않는다.

export const NO_CANCEL: CancelScope = { abortSignal: undefined };

/**
 * 지금 경로에 있는 것. `denied`는 쓰기 루트 검사나 보호 경로 검사에서 막힌 경로(읽지 않는다)이고,
 * `unreadable`은 읽기가 실패한 경우, `other`는 파일이 아닌 것(디렉터리, 링크)이다.
 */
export type CurrentFile =
  | { readonly kind: "absent" }
  | { readonly kind: "file"; readonly bytes: Uint8Array; readonly sha256: string }
  | { readonly kind: "other" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "denied" };

/** 경로 마디가 없거나 중간이 파일인 것은 "없음"이다 */
const MISSING_CODES: ReadonlySet<string> = new Set(["not_found", "not_directory"]);

export async function readCurrent(env: WorkspaceEnv, path: string): Promise<CurrentFile> {
  const info = await env.fileInfo(path, NO_CANCEL);
  if (!info.ok) {
    return MISSING_CODES.has(info.error.code) ? { kind: "absent" } : { kind: "unreadable" };
  }
  if (info.value.kind !== "file") return { kind: "other" };
  const bytes = await env.readBinaryFile(path, NO_CANCEL);
  if (!bytes.ok) return { kind: "unreadable" };
  return { kind: "file", bytes: bytes.value, sha256: sha256Bytes(bytes.value) };
}

/** 현재 상태가 옛 상태(`FileBefore`)와 같은가. 저장하지 못한 옛 상태와는 같은지 알 수 없어 거짓이다 */
export function matchesBefore(current: CurrentFile, before: FileBefore): boolean {
  switch (before.state) {
    case "absent":
      return current.kind === "absent";
    case "saved":
      return current.kind === "file" && current.sha256 === before.blob.sha256;
    case "unrestorable":
      return false;
    default:
      return assertNever(before, "FileBefore");
  }
}

/** 현재 상태가 해시로 적힌 내용과 같은가. null은 파일이 없어야 한다는 뜻이다 */
export function matchesSha(current: CurrentFile, sha256: string | null): boolean {
  if (sha256 === null) return current.kind === "absent";
  return current.kind === "file" && current.sha256 === sha256;
}

/** 같은 디렉터리의 임시 파일 이름. 이름 바꾸기가 같은 파일 시스템 안에서 일어나게 한다 */
function tempPathOf(path: string): string {
  const cut = path.lastIndexOf("/");
  const dir = cut < 0 ? "" : path.slice(0, cut + 1);
  const name = cut < 0 ? path : path.slice(cut + 1);
  return `${dir}.${name}.fresnel-tmp-${randomUUID()}`;
}

/** 임시 파일을 지운다. 원래 실패를 먼저 알려야 하므로 지우기 결과는 보지 않는다. 신호 없는 문맥으로 지운다 */
async function discardTemp(
  env: WorkspaceEnv,
  temp: string,
  code: string,
): Promise<Result<void, string>> {
  await env.remove(temp, { force: true }, { abortSignal: undefined });
  return err(code);
}

/** `path`에 바이트 `bytes`를 원자적으로 쓴다. 실패하면 임시 파일을 지우고 대상은 건드리지 않는다 */
export async function writeBytes(
  env: WorkspaceEnv,
  path: string,
  bytes: Uint8Array,
): Promise<Result<void, string>> {
  const temp = tempPathOf(path);
  const wrote = await env.writeFile(temp, bytes, NO_CANCEL);
  if (!wrote.ok) return discardTemp(env, temp, wrote.error.code);
  // 디스크에 내려간 뒤에 이름을 바꾼다. 그렇지 않으면 전원 손실 뒤 빈 파일이 대상이 될 수 있다
  const flushed = await env.flushFile(temp, NO_CANCEL);
  if (!flushed.ok) return discardTemp(env, temp, flushed.error.code);
  const renamed = await env.renameFile(temp, path, NO_CANCEL);
  if (!renamed.ok) return discardTemp(env, temp, renamed.error.code);
  return ok(undefined);
}

/** 파일을 지운다. 이미 없으면 성공이다. 빈 디렉터리는 지우지 않는다 */
export async function removeFile(env: WorkspaceEnv, path: string): Promise<Result<void, string>> {
  const removed = await env.remove(path, undefined, NO_CANCEL);
  if (removed.ok) return ok(undefined);
  return removed.error.code === "not_found" ? ok(undefined) : err(removed.error.code);
}

/** 사용자의 `.git` 안 경로인가. 되감기는 이 안을 건드리지 않는다 */
export function isGitPath(path: string): boolean {
  return path.split(/[\\/]+/).includes(".git");
}

/** 항목을 앞에서부터 하나씩 기다려 값을 모은다. 같은 파일 시스템에 한 번에 한 작업만 보내려고 쓴다 */
export async function inOrder<I, T>(
  items: readonly I[],
  step: (item: I) => T | Promise<T>,
): Promise<T[]> {
  const out: T[] = [];
  await eachAsync(items, async (item) => {
    out.push(await step(item));
    return undefined;
  });
  return out;
}
