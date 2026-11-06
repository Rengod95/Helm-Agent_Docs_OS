import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import {
  UPDATE_REASONS,
  type CheckOutcome,
  type DownloadOutcome,
  type InstallOutcome,
  type UpdateReason,
} from "./update-model.ts";

// 업데이트 명령의 invoke 모양과 응답 읽기(B-10). 명령은 Rust `updater.rs`가 등록하고 WebView에는 업데이트 플러그인 권한을 주지 않는다.
// 운영은 main.tsx가 `@tauri-apps/api/core`의 `invoke`와 `Channel`을 넘기고, 시험은 가짜를 넣는다(os-reauth.ts와 같은 방식).
// 응답은 `as` 없이 타입 가드로 읽는다. 모양이 틀리면 확인과 내려받기는 `other`, 설치도 `other`로 본다.

type UpdateCommand =
  | "update_status"
  | "update_check"
  | "update_download"
  | "update_install_restart";

/** 명령을 부르는 invoke 모양. 내려받기만 진행 통로 `onEvent`를 인자로 받는다 */
export type UpdateInvoke = (
  command: UpdateCommand,
  args?: { readonly onEvent?: unknown },
) => Promise<unknown>;

/** 진행 통로를 만든다. 받은 조각은 `onMessage`로 간다. 운영은 main.tsx가 Tauri `Channel`을 만들어 넘긴다 */
export type UpdateChannelOf = (onMessage: (event: unknown) => void) => unknown;

/** 내려받기 진행 한 번. 전체 크기를 모르면 `total`은 `null`이다 */
export interface DownloadProgress {
  readonly downloaded: number;
  readonly total: number | null;
}

/** `update_status`의 답. `currentVersion`은 지금 실행 중인 버전이다 */
export interface UpdaterStatus {
  readonly configured: boolean;
  readonly currentVersion: string;
}

/** 설정과 현재 버전을 읽는다. 답이 모양과 다르거나 명령이 거부되면 `unreadable`이다 */
export async function readUpdaterStatus(
  invoke: UpdateInvoke,
): Promise<Result<UpdaterStatus, "unreadable">> {
  const reply = await attemptAsync(() => invoke("update_status"));
  if (!reply.ok) return err("unreadable");
  const configured = fieldOf(reply.value, "configured");
  const currentVersion = fieldOf(reply.value, "currentVersion");
  if (typeof configured !== "boolean" || typeof currentVersion !== "string") {
    return err("unreadable");
  }
  return ok({ configured, currentVersion });
}

/** 새 버전이 있는지 확인한다. 명령이 거부되면 `other` 실패다 */
export async function checkForUpdate(invoke: UpdateInvoke): Promise<CheckOutcome> {
  const reply = await attemptAsync(() => invoke("update_check"));
  if (!reply.ok) return { kind: "failed", reason: "other" };
  return checkOutcomeOf(reply.value);
}

/**
 * 찾은 업데이트를 내려받는다. 진행 조각은 `onProgress`로 간다. 조각의 모양이 틀리면 버린다.
 * 명령이 거부되면 `other` 실패다.
 */
export async function downloadUpdate(
  invoke: UpdateInvoke,
  createChannel: UpdateChannelOf,
  onProgress: (progress: DownloadProgress) => void,
): Promise<DownloadOutcome> {
  const channel = createChannel((message) => {
    const progress = progressOf(message);
    if (progress !== null) onProgress(progress);
  });
  const reply = await attemptAsync(() => invoke("update_download", { onEvent: channel }));
  if (!reply.ok) return { kind: "failed", reason: "other" };
  return downloadOutcomeOf(reply.value);
}

/**
 * 내려받은 바이트를 설치하고 앱을 다시 연다. 성공하면 앱이 다시 시작되어 이 답은 오지 않는다.
 * 답이 오면 실패다. 명령이 거부되거나 모양이 다르면 `other`다.
 */
export async function installUpdate(invoke: UpdateInvoke): Promise<InstallOutcome> {
  const reply = await attemptAsync(() => invoke("update_install_restart"));
  if (!reply.ok) return { kind: "failed", reason: "other" };
  const kind = kindOf(reply.value);
  if (kind === "offline") return { kind: "offline" };
  if (kind === "failed")
    return { kind: "failed", reason: reasonOf(fieldOf(reply.value, "reason")) };
  return { kind: "failed", reason: "other" };
}

function checkOutcomeOf(reply: unknown): CheckOutcome {
  const kind = kindOf(reply);
  if (kind === "notConfigured") return { kind: "notConfigured" };
  if (kind === "upToDate") return { kind: "upToDate" };
  if (kind === "offline") return { kind: "offline" };
  if (kind === "failed") return { kind: "failed", reason: reasonOf(fieldOf(reply, "reason")) };
  if (kind === "available") {
    const version = fieldOf(reply, "version");
    if (typeof version !== "string" || version.trim() === "") {
      return { kind: "failed", reason: "other" };
    }
    const notes = fieldOf(reply, "notes");
    return {
      kind: "available",
      version,
      notes: typeof notes === "string" && notes.trim() !== "" ? notes : null,
    };
  }
  return { kind: "failed", reason: "other" };
}

function downloadOutcomeOf(reply: unknown): DownloadOutcome {
  const kind = kindOf(reply);
  if (kind === "ready") return { kind: "ready" };
  if (kind === "offline") return { kind: "offline" };
  if (kind === "failed") return { kind: "failed", reason: reasonOf(fieldOf(reply, "reason")) };
  return { kind: "failed", reason: "other" };
}

/** 진행 조각 하나를 읽는다. `kind`가 `progress`이고 받은 바이트 수가 음이 아닌 수일 때만 읽힌다 */
function progressOf(message: unknown): DownloadProgress | null {
  if (kindOf(message) !== "progress") return null;
  const downloaded = fieldOf(message, "downloaded");
  if (typeof downloaded !== "number" || !Number.isFinite(downloaded) || downloaded < 0) {
    return null;
  }
  const total = fieldOf(message, "total");
  const knownTotal =
    typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : null;
  return { downloaded, total: knownTotal };
}

/** 답의 `kind`. 답이 객체가 아니거나 글이 아니면 빈 글이다(어떤 종류와도 맞지 않는다) */
function kindOf(reply: unknown): string {
  const kind = fieldOf(reply, "kind");
  return typeof kind === "string" ? kind : "";
}

/** 이유 코드. 모르는 값은 `other`다 */
function reasonOf(value: unknown): UpdateReason {
  return UPDATE_REASONS.find((reason) => reason === value) ?? "other";
}

/** 답이 칸을 가진 객체인지 본다. 배열도 객체로 본다(칸 이름이 없으면 `undefined`로 읽힌다) */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

/** 답의 한 칸. 답이 객체가 아니거나 칸이 없으면 `undefined`다 */
function fieldOf(reply: unknown, key: string): unknown {
  return isRecord(reply) ? reply[key] : undefined;
}
