import { assertNever, attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import type { ExtUiEntry } from "@fresnel/contracts/wire";

// Plugin App 앱 root 목록을 셸에 알린다(ADR-0021 §3.6.2, `app_roots_set`). 목록은 `ext.ui.list` 항목에서 만들고 builtin은 뺀다.
// 목록은 통째로 바뀌고 Rust가 설치 폴더 모양을 다시 본다. 이 층은 보낼 모양만 정하고, 거부 이유는 kind 하나로만 옮긴다.

/** `app_roots_set`의 항목 하나. Rust `AppRootInput`과 같은 이름이다 */
export interface AppRootEntry {
  readonly extension: string;
  readonly version: string;
  /** app root 폴더의 절대 경로 */
  readonly root: string;
  /** root 안 HTML의 상대 경로 */
  readonly entry: string;
  /** 설치 등급. builtin은 설치 폴더가 없어 목록에 넣지 않는다 */
  readonly trust: "user" | "project" | "managed";
}

/** Rust `app_roots_set`이 `Err(String)`으로 돌려주는 거부 이유(`view_scheme.rs`의 `RootsError`) */
export const APP_ROOT_ERROR_KINDS = [
  "too_many",
  "bad_name",
  "bad_version",
  "bad_entry",
  "not_absolute",
  "not_a_directory",
  "too_broad",
  "outside_install",
] as const;
type AppRootErrorKind = (typeof APP_ROOT_ERROR_KINDS)[number];

export interface AppRootsSyncError {
  /** 거부 이유. 셸이 모르는 글이면 `unknown`이다(글 자체는 옮기지 않는다) */
  readonly kind: AppRootErrorKind | "unknown";
}

/** 셸 `invoke`를 구조로만 받는다. 운영은 셸 다리의 `invoke`를, 시험은 가짜를 넣는다 */
export type AppRootsInvoke = (
  command: "app_roots_set",
  args: { readonly entries: readonly AppRootEntry[] },
) => Promise<unknown>;

function appRootOf(item: ExtUiEntry): AppRootEntry | undefined {
  // 앱 화면이고 검사를 통과했고 설치 폴더가 있을 때만 root가 있다. builtin은 설치 폴더가 없다
  if (item.mode !== "app" || item.state !== "ok") return undefined;
  if (item.appRoot === undefined || item.app === undefined) return undefined;
  const base = {
    extension: item.extension,
    version: item.version,
    root: item.appRoot,
    entry: item.app.entry,
  };
  switch (item.trust) {
    case "builtin":
      return undefined;
    case "user":
    case "project":
    case "managed":
      return { ...base, trust: item.trust };
    default:
      return assertNever(item.trust, "ExtTrust");
  }
}

/** 화면 항목에서 `app_roots_set`에 보낼 목록을 만든다. 순서는 입력 순서를 따른다 */
export function appRootInputs(entries: readonly ExtUiEntry[]): readonly AppRootEntry[] {
  return entries.flatMap((item) => {
    const root = appRootOf(item);
    return root === undefined ? [] : [root];
  });
}

function isAppRootErrorKind(text: string): text is AppRootErrorKind {
  return APP_ROOT_ERROR_KINDS.some((kind) => kind === text);
}

function errorKindOf(cause: unknown): AppRootErrorKind | "unknown" {
  return typeof cause === "string" && isAppRootErrorKind(cause) ? cause : "unknown";
}

/** 셸이 건너뛴 항목 하나. 항목의 글은 옮기지 않고 확장 이름과 버전, 이유만 남긴다 */
export interface SkippedAppRoot {
  readonly extension: string;
  readonly version: string;
  readonly kind: AppRootErrorKind | "unknown";
}

/** 셸의 답에서 건너뛴 자리와 이유를 읽는다. 모양이 다르면(옛 셸의 `null` 포함) 건너뛴 것이 없는 것으로 본다 */
function skippedOf(reply: unknown, sent: readonly AppRootEntry[]): readonly SkippedAppRoot[] {
  if (!Array.isArray(reply)) return [];
  const out: SkippedAppRoot[] = [];
  const rows: readonly unknown[] = reply;
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const index: unknown = Object.getOwnPropertyDescriptor(row, "index")?.value;
    const kind: unknown = Object.getOwnPropertyDescriptor(row, "kind")?.value;
    const target = typeof index === "number" ? sent[index] : undefined;
    if (target === undefined) continue;
    out.push({
      extension: target.extension,
      version: target.version,
      kind: typeof kind === "string" && isAppRootErrorKind(kind) ? kind : "unknown",
    });
  }
  return out;
}

/**
 * 앱 root 목록을 셸에 통째로 보낸다. 명령은 한 번만 부른다. 던지지 않고 거부 이유를 `kind`로 돌려준다.
 * 항목 하나가 나빠도 나머지는 등록되고, 셸이 건너뛴 항목은 값으로 돌려준다
 */
export async function syncAppRoots(
  invoke: AppRootsInvoke,
  entries: readonly ExtUiEntry[],
): Promise<Result<readonly SkippedAppRoot[], AppRootsSyncError>> {
  const inputs = appRootInputs(entries);
  const sent = await attemptAsync(() => invoke("app_roots_set", { entries: inputs }));
  return sent.ok ? ok(skippedOf(sent.value, inputs)) : err({ kind: errorKindOf(sent.error.cause) });
}
