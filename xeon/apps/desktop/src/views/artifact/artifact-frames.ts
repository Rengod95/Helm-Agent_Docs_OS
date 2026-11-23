import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";

// 산출물 화면 틀(frame)을 셸에 여는 호출의 렌더러 쪽. 셸 명령(artifact_frame_open, artifact_frame_status, artifact_reveal)을
// 주입된 invoke로 부른다. 던지지 않는다. 셸의 답은 모양을 확인한 뒤 쓰고, 모양이 틀리면 unavailable이다.

export type ArtifactInvoke = (
  command: string,
  args?: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export interface ArtifactFrameRequest {
  readonly root: string | null;
  readonly entry: string;
  readonly text: string | null;
  readonly wrap: "none" | "image";
}

export interface ArtifactFrame {
  readonly token: string;
  readonly url: string;
}

const FRAME_ERROR_KINDS = [
  "bad_entry",
  "forbidden_type",
  "not_absolute",
  "not_a_directory",
  "too_broad",
  "no_source",
  "too_large",
  "unavailable",
] as const;

export type ArtifactFrameErrorKind = (typeof FRAME_ERROR_KINDS)[number];

export interface FrameRefusal {
  readonly path: string;
  readonly kind: string;
}

const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const field: unknown = Object.getOwnPropertyDescriptor(value, key)?.value;
  return field;
}

function stringField(value: unknown, key: string): string | null {
  const field = fieldOf(value, key);
  return typeof field === "string" ? field : null;
}

function isFrameErrorKind(text: string): text is ArtifactFrameErrorKind {
  return FRAME_ERROR_KINDS.some((kind) => kind === text);
}

/** 거절된 Error에서 읽을 글: message, 그리고 cause가 글이면 그것 */
function textsOf(cause: unknown): readonly string[] {
  if (!(cause instanceof Error)) return [];
  return typeof cause.cause === "string" ? [cause.message, cause.cause] : [cause.message];
}

/** 거부 이유 kind. 읽은 글 가운데 kind가 있으면 그것, 없으면 unavailable이다 */
function kindOfCause(cause: unknown): ArtifactFrameErrorKind {
  for (const text of textsOf(cause)) {
    if (isFrameErrorKind(text)) return text;
  }
  return "unavailable";
}

/** 셸의 답에서 틀을 읽는다. 토큰은 32자 소문자 16진수이고 주소는 그 토큰의 자기 주소여야 한다 */
function frameOf(reply: unknown): ArtifactFrame | null {
  const token = stringField(reply, "token");
  const url = stringField(reply, "url");
  if (token === null || url === null || !TOKEN_PATTERN.test(token)) return null;
  return url.startsWith(`fresnel-artifact://${token}/`) ? { token, url } : null;
}

/** 셸의 답에서 거부 목록을 읽는다. 목록이 아니거나 행 하나라도 모양이 다르면 null이다 */
function refusalsOf(reply: unknown): readonly FrameRefusal[] | null {
  const rows: unknown = fieldOf(reply, "refused");
  if (!Array.isArray(rows)) return null;
  const list: readonly unknown[] = rows;
  const out: FrameRefusal[] = [];
  for (const row of list) {
    const path = stringField(row, "path");
    const kind = stringField(row, "kind");
    if (path === null || kind === null) return null;
    out.push({ path, kind });
  }
  return out;
}

/** 산출물 틀을 연다. 셸이 거절하면 그 kind를, 답이 틀리거나 알 수 없는 실패면 unavailable을 준다 */
export async function openArtifactFrame(
  invoke: ArtifactInvoke,
  request: ArtifactFrameRequest,
): Promise<Result<ArtifactFrame, { readonly kind: ArtifactFrameErrorKind }>> {
  const sent = await attemptAsync(() =>
    invoke("artifact_frame_open", {
      root: request.root,
      entry: request.entry,
      text: request.text,
      wrap: request.wrap,
    }),
  );
  if (!sent.ok) return err({ kind: kindOfCause(sent.error.cause) });
  const frame = frameOf(sent.value);
  return frame === null ? err({ kind: "unavailable" }) : ok(frame);
}

/** 틀이 거절한 파일 목록을 읽는다. 실패하거나 답의 모양이 틀리면 unavailable이다 */
export async function artifactFrameRefusals(
  invoke: ArtifactInvoke,
  token: string,
): Promise<Result<readonly FrameRefusal[], { readonly kind: "unavailable" }>> {
  const sent = await attemptAsync(() => invoke("artifact_frame_status", { token }));
  if (!sent.ok) return err({ kind: "unavailable" });
  const refused = refusalsOf(sent.value);
  return refused === null ? err({ kind: "unavailable" }) : ok(refused);
}

/** 산출물이 있는 폴더를 파일 관리자로 연다. 실패하면 unavailable이다 */
export async function revealArtifact(
  invoke: ArtifactInvoke,
  token: string,
): Promise<Result<null, { readonly kind: "unavailable" }>> {
  const sent = await attemptAsync(() => invoke("artifact_reveal", { token }));
  return sent.ok ? ok(null) : err({ kind: "unavailable" });
}
