import { t } from "@fresnel/client/i18n";
import { WIRE_LIMITS, type WireParams } from "@fresnel/contracts/wire";
import type { AttachmentParts, CommandError } from "./commands.ts";

// 입력창 첨부의 순수 부분(U-03). 칩 상태, 실패 이유, 입력 파트 조립, 파일 → `data` 소스를 화면에서 떼어 시험한다.

export type AttachmentSource = WireParams<"attachments.add">["source"];
export type TurnInput = WireParams<"turn.start">["input"];

/** 올리지 못한 이유. 한도 초과와 형식 불가는 호스트가 문장 머리의 코드로 알린다(`command-error.ts`) */
export type AttachFailure =
  | { readonly kind: "tooLarge"; readonly limit: number | null }
  | { readonly kind: "unsupported" }
  | { readonly kind: "other"; readonly error: CommandError };

export type AttachChip = {
  readonly id: string;
  readonly name: string;
  readonly size: number | null;
  /** 다시 시도할 때 같은 소스를 다시 보낸다 */
  readonly source: AttachmentSource;
  readonly status: "uploading" | "ready" | "failed";
  readonly failure: AttachFailure | null;
  /** 올린 뒤 입력에 넣을 파트 */
  readonly parts: AttachmentParts | null;
};

const LIMIT_IN_ISSUE = /over the (\d+) byte limit/;

/** 호스트가 `attachment_too_large: ...over the N byte limit.`으로 준 한도. 문장에 없으면 미리 읽은 값을 쓴다 */
export function failureOf(error: CommandError, knownLimit: number | null): AttachFailure {
  if (error.kind === "rejected" && error.issue !== undefined) {
    if (error.issue.startsWith("attachment_too_large: ")) {
      const found = LIMIT_IN_ISSUE.exec(error.issue)?.[1];
      return { kind: "tooLarge", limit: found === undefined ? knownLimit : Number(found) };
    }
    if (error.issue.startsWith("attachment_type_unsupported: ")) return { kind: "unsupported" };
  }
  return { kind: "other", error };
}

/** 사람이 읽는 크기. 1024 단위 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text =
    value >= 10 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1);
  return `${text} ${units[unit]}`;
}

/** 칩에 한 줄로 보이는 실패 이유 */
export function failureText(failure: AttachFailure): string {
  if (failure.kind === "tooLarge") {
    return failure.limit === null
      ? t("desktop.composer.attach.error.tooLargeUnknown")
      : t("desktop.composer.attach.error.tooLarge", { limit: formatBytes(failure.limit) });
  }
  if (failure.kind === "unsupported") return t("desktop.composer.attach.error.unsupported");
  if (failure.error.kind === "offline") return t("desktop.composer.error.offline");
  if (failure.error.kind === "switching") return t("desktop.composer.error.switching");
  return t("desktop.composer.attach.error.failed");
}

/** 요청 한 줄에 `threadId`, 이름, 형식 같은 겉 글자가 차지할 자리(바이트) */
const FRAME_ENVELOPE_BYTES = 8 * 1024;

/**
 * 파일을 바이트째 보내는 길(끌어놓기, 붙여넣기, 파일 칸)에서 한 번에 올릴 수 있는 크기. 데이터는 base64로 한 요청 줄에 실리고
 * 줄 하나는 `WIRE_LIMITS.maxFrameBytes`를 넘지 못하므로, 엔진 설정 한도(`knownLimit`)가 더 커도 이 값이 실제 한도다.
 * 경로로 올리는 길(파일 선택 창)은 이 값에 걸리지 않는다
 */
export function dataSourceLimit(knownLimit: number | null): number {
  const framed = Math.floor((WIRE_LIMITS.maxFrameBytes - FRAME_ENVELOPE_BYTES) / 4) * 3;
  return knownLimit === null ? framed : Math.min(knownLimit, framed);
}

/** 올리기 전에 알 수 있는 크기 초과. 한도를 모르면 엔진이 판정한다 */
export function exceedsLimit(size: number, limit: number | null): boolean {
  return limit !== null && size > limit;
}

/** 단추와 놓기를 막는 이유. null이면 첨부할 수 있다 */
export function attachDisabledReason(input: {
  readonly composerReason: string | null;
  readonly running: boolean;
}): string | null {
  if (input.composerReason !== null) return input.composerReason;
  // 턴이 도는 중의 보내기는 큐에 넣는 입력이다. 큐 입력은 첨부를 싣지 않으므로 잠근다
  if (input.running) return t("desktop.composer.attach.disabled.running");
  return null;
}

/** 글과 올린 파트를 `turn.start` 입력으로 묶는다. 글이 비면 파트만 보낸다 */
export function turnInputOf(text: string, parts: AttachmentParts): TurnInput {
  if (parts.length === 0) return text;
  return text === "" ? [...parts] : [{ type: "text", text }, ...parts];
}

export function chipsReady(chips: readonly AttachChip[]): boolean {
  return chips.every((c) => c.status === "ready");
}

/** 보내기를 막는 첨부가 있을 때 왜 못 보내는지 한 문장. 막을 것이 없으면 null */
export function sendBlockedText(chips: readonly AttachChip[]): string | null {
  const failed = chips.find((c) => c.status === "failed" && c.failure !== null);
  const failure = failed?.failure ?? null;
  if (failed !== undefined && failure !== null) {
    return t("desktop.composer.attach.blocked.failed", {
      name: failed.name,
      reason: failureText(failure),
    });
  }
  if (chips.some((c) => c.status === "uploading")) {
    return t("desktop.composer.attach.blocked.uploading");
  }
  return null;
}

/** 칩에 보일 이미지 미리보기 data URL. 이미지 데이터 소스가 아니면 null */
export function chipPreviewOf(chip: AttachChip): string | null {
  const source = chip.source;
  if (source.kind !== "data" || !source.mime.startsWith("image/") || chip.status === "failed")
    return null;
  return `data:${source.mime};base64,${source.data}`;
}

export function readyParts(chips: readonly AttachChip[]): AttachmentParts {
  return chips.flatMap((c) => (c.status === "ready" && c.parts !== null ? c.parts : []));
}

export function replaceChip(
  chips: readonly AttachChip[],
  id: string,
  next: (chip: AttachChip) => AttachChip,
): readonly AttachChip[] {
  return chips.map((c) => (c.id === id ? next(c) : c));
}

const CHUNK = 0x8000;

/** 바이트를 base64로. 큰 배열도 인자 한도에 걸리지 않게 조각으로 나눈다 */
export function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** 끌어놓거나 붙여넣은 파일을 `data` 소스로. 원격 엔진에서도 되도록 경로는 쓰지 않는다 */
export async function sourceOfFile(file: File): Promise<AttachmentSource> {
  const data = base64Of(new Uint8Array(await file.arrayBuffer()));
  const mime = file.type === "" ? "application/octet-stream" : file.type;
  return file.name === ""
    ? { kind: "data", data, mime }
    : { kind: "data", data, mime, name: file.name };
}

/** 경로의 마지막 조각(칩 이름) */
export function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p !== "");
  return parts[parts.length - 1] ?? path;
}
