import { attempt, parseJson } from "@fresnel/contracts";
import type { ItemId, ItemRecord, JsonValue } from "@fresnel/contracts/conversation";

// 산출물 모델(순수, 던지지 않는다). 대화 transcript만으로 파일 쓰기·편집(write, edit)과 등록 산출물(artifact_create, artifact_update)의
// 버전을 다시 만든다. 새 저장소는 없다. 버전 본문은 호출 인자에서 오고, 편집은 편집 도구와 같은 규칙으로 적용한다.
// 적용이 어긋나면 그 버전의 본문은 null이다(다시 만들 수 없음). 결과가 없거나 오류인 호출은 버전이 아니다.

export type ArtifactKind = "html" | "svg" | "image" | "markdown";

const KIND_OF_EXTENSION: ReadonlyMap<string, ArtifactKind> = new Map<string, ArtifactKind>([
  ["html", "html"],
  ["htm", "html"],
  ["svg", "svg"],
  ["png", "image"],
  ["jpg", "image"],
  ["jpeg", "image"],
  ["gif", "image"],
  ["webp", "image"],
  ["md", "markdown"],
  ["markdown", "markdown"],
]);

const KIND_OF_MEDIA_TYPE: ReadonlyMap<string, ArtifactKind> = new Map<string, ArtifactKind>([
  ["text/html", "html"],
  ["image/svg+xml", "svg"],
  ["text/markdown", "markdown"],
  ["image/png", "image"],
  ["image/jpeg", "image"],
  ["image/gif", "image"],
  ["image/webp", "image"],
]);

const MAX_LIST = 8;
const W3_HOST = "www.w3.org";
// 따옴표와 백틱은 \x22 \x27 \x60로 적는다(시험 스캔이 정규식 안의 따옴표를 문자열로 읽지 않도록)
const URL_PATTERN = /https?:\/\/[^\s\x22\x27<>()\x60\\]+/gi;
// src=, href=, url( ), @import 의 참조 값. 값은 따옴표 세 가지와 따옴표 없는 형태 가운데 하나에서 온다
const REF_PATTERN =
  /\b(?:src|href)\s*=\s*(?:\x22([^\x22]*)\x22|\x27([^\x27]*)\x27|([^\s\x22\x27>]+))|url\(\s*(?:\x22([^\x22]*)\x22|\x27([^\x27]*)\x27|([^)\s\x22\x27]*))\s*\)|@import\s+(?:\x22([^\x22]*)\x22|\x27([^\x27]*)\x27)/gi;

/** 경로의 마지막 조각(파일 이름). 끝이 `/`면 빈 글이다 */
function lastSegmentOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** 확장자로 보는 산출물 종류. 대소문자를 가리지 않는다. 확장자가 없거나 목록에 없으면 null */
export function artifactKindOfPath(path: string): ArtifactKind | null {
  const name = lastSegmentOf(path);
  const dot = name.lastIndexOf(".");
  // 맨 앞의 점은 숨김 파일 이름이지 확장자가 아니다
  if (dot <= 0) return null;
  return KIND_OF_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? null;
}

/** 미디어 타입으로 보는 산출물 종류. `;` 뒤 매개변수와 대소문자를 무시한다 */
export function artifactKindOfMediaType(mediaType: string): ArtifactKind | null {
  const semi = mediaType.indexOf(";");
  const bare = (semi < 0 ? mediaType : mediaType.slice(0, semi)).trim().toLowerCase();
  return KIND_OF_MEDIA_TYPE.get(bare) ?? null;
}

type ArtifactOp = "write" | "edit" | "create" | "update";

export interface ArtifactVersion {
  readonly number: number;
  readonly callId: string;
  readonly itemId: ItemId;
  readonly op: ArtifactOp;
  /** 이 버전의 전체 본문. 다시 만들 수 없으면 null */
  readonly text: string | null;
}

type ArtifactSource =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "registered"; readonly artifactId: string };

export interface ArtifactEntry {
  readonly key: string;
  readonly source: ArtifactSource;
  /** 마지막 버전의 종류 */
  readonly kind: ArtifactKind;
  readonly title: string;
  /** 대화 순서. 성공한 호출만 */
  readonly versions: readonly ArtifactVersion[];
  /** 보냈지만 결과가 아직 없는 호출이 이 산출물에 있다 */
  readonly pending: boolean;
}

interface Replacement {
  readonly oldText: string;
  readonly newText: string;
}

/** 도구 호출 하나. 인자는 모델이 보낸 JSON이라 모양을 믿지 않고 읽을 때 확인한다 */
interface Call {
  readonly callId: string;
  readonly itemId: ItemId;
  readonly name: string;
  readonly args: unknown;
}

/** 도구 결과 하나. 본문 글은 텍스트 조각을 줄바꿈으로 잇는다 */
interface CallResult {
  readonly isError: boolean;
  readonly details: JsonValue | null;
  readonly text: string;
}

/** 산출물 하나를 모으는 중의 상태. 끝에 버전도 대기도 없으면 버린다 */
interface Draft {
  readonly key: string;
  readonly source: ArtifactSource;
  kind: ArtifactKind;
  title: string;
  readonly versions: ArtifactVersion[];
  pending: boolean;
}

/** 객체의 자기 속성 값. 객체가 아니거나 없으면 undefined */
function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const field: unknown = Object.getOwnPropertyDescriptor(value, key)?.value;
  return field;
}

function stringField(value: unknown, key: string): string | null {
  const field = fieldOf(value, key);
  return typeof field === "string" ? field : null;
}

/** 빈 글이 아닌 문자열 필드 */
function idField(value: unknown, key: string): string | null {
  const field = stringField(value, key);
  return field === null || field === "" ? null : field;
}

function resultsOf(
  itemIds: readonly ItemId[],
  items: Readonly<Record<string, ItemRecord>>,
): ReadonlyMap<string, CallResult> {
  const results = new Map<string, CallResult>();
  for (const id of itemIds) {
    const item = items[id];
    if (item?.kind !== "toolResult") continue;
    const message = item.message;
    const text = message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n");
    results.set(message.toolCallId, {
      isError: message.isError,
      details: message.details ?? null,
      text,
    });
  }
  return results;
}

/** 등록 산출물의 id. 결과 `details`의 `artifactId`가 먼저고, 없으면 결과 글의 `artifact <id> v<n>`에서 읽는다 */
function registeredIdOf(details: JsonValue | null, text: string | null): string | null {
  const fromDetails = idField(details, "artifactId");
  if (fromDetails !== null) return fromDetails;
  const match = text === null ? null : /^artifact (\S+) v\d+/.exec(text);
  return match?.[1] ?? null;
}

/** artifact_create가 만드는 종류. 미디어 타입이 없으면 table은 CSV, 그 밖은 markdown이다(도구 기본값과 같다) */
function createKindOf(args: unknown): ArtifactKind | null {
  const mediaType =
    stringField(args, "mediaType") ??
    (stringField(args, "kind") === "table" ? "text/csv" : "text/markdown");
  return artifactKindOfMediaType(mediaType);
}

/** write·edit 호출의 산출물 자리. 종류가 보이는 경로만 대상이고, 경로는 정규화한다 */
function fileTargetOf(
  args: unknown,
  workspace: string | null,
): { readonly path: string; readonly kind: ArtifactKind } | null {
  const raw = stringField(args, "path");
  if (raw === null) return null;
  const kind = artifactKindOfPath(raw);
  return kind === null ? null : { path: normalizeArtifactPath(raw, workspace), kind };
}

function replacementOf(value: unknown): Replacement | null {
  const oldText = stringField(value, "oldText");
  const newText = stringField(value, "newText");
  return oldText === null || newText === null ? null : { oldText, newText };
}

/** 편집 도구 인자를 편집 목록으로 바꾼다. 도구와 같이 JSON 글, 단일 객체, 최상위 oldText/newText를 받는다 */
export function editsOfArgs(args: unknown): readonly Replacement[] | null {
  let raw: unknown = fieldOf(args, "edits");
  if (typeof raw === "string") {
    const decoded = parseJson(raw);
    // JSON이 아니면 edits가 없는 입력으로 보고 최상위 쌍을 쓴다
    raw = decoded.ok ? decoded.value : [];
  }
  if (raw !== undefined && !Array.isArray(raw)) raw = [raw];
  const rows: readonly unknown[] = Array.isArray(raw) ? raw : [];
  const list = rows.flatMap((row) => {
    const replacement = replacementOf(row);
    return replacement === null ? [] : [replacement];
  });
  if (list.length > 0) return list;
  const oldText = stringField(args, "oldText");
  const newText = stringField(args, "newText");
  return oldText === null || newText === null ? null : [{ oldText, newText }];
}

/**
 * 편집을 편집 도구처럼 적용한다. 모든 oldText는 비어 있지 않고 원본에 정확히 한 번 있어야 하며(겹쳐 세는 것은 세지 않는다),
 * 편집끼리 겹치면 안 된다. 모두 원본에 대고 위치 순서로 적용한다. 어긋나면, 바뀌는 것이 없으면 null이다.
 * CR이 끼면 도구가 줄바꿈을 LF로 맞춘 뒤 되돌리는데 그 규칙은 옮기지 않으므로 null이다.
 */
export function applyEdits(base: string, edits: readonly Replacement[]): string | null {
  if (edits.length === 0) return null;
  if (base.includes("\r")) return null;
  const placed: { readonly start: number; readonly end: number; readonly newText: string }[] = [];
  for (const edit of edits) {
    if (edit.oldText === "" || edit.oldText.includes("\r") || edit.newText.includes("\r")) {
      return null;
    }
    if (base.split(edit.oldText).length !== 2) return null;
    const start = base.indexOf(edit.oldText);
    placed.push({ start, end: start + edit.oldText.length, newText: edit.newText });
  }
  let out = "";
  let cursor = 0;
  for (const p of placed.toSorted((a, b) => a.start - b.start)) {
    // 앞 편집이 이 편집의 자리를 덮으면 겹친 것이다
    if (p.start < cursor) return null;
    out += base.slice(cursor, p.start) + p.newText;
    cursor = p.end;
  }
  out += base.slice(cursor);
  return out === base ? null : out;
}

/** 경로를 정리한다: 앞의 `./`를 떼고, 연속 `/`를 하나로, 끝의 `/`를 뗀다 */
function cleanPath(path: string): string {
  let out = path.replace(/\/{2,}/g, "/");
  while (out.startsWith("./")) out = out.slice(2);
  return out.length > 1 && out.endsWith("/") ? out.slice(0, -1) : out;
}

/** 모델이 준 경로를 키로 쓸 모양으로 바꾼다. 절대 경로가 작업 폴더 안(조각 단위)이면 작업 폴더 기준 상대 경로가 된다 */
export function normalizeArtifactPath(path: string, workspace: string | null): string {
  const clean = cleanPath(path);
  const root = workspace === null ? "" : cleanPath(workspace);
  if (root === "" || !clean.startsWith("/")) return clean;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return clean.startsWith(prefix) ? clean.slice(prefix.length) : clean;
}

/** 작업 폴더 안을 가리키는 상대 경로인가: 빈 조각, `.`, `..`, 역슬래시, NUL이 없어야 한다 */
function isSafeRelativePath(path: string): boolean {
  if (path === "" || path.startsWith("/")) return false;
  return path
    .split("/")
    .every(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        !segment.includes("\\") &&
        !segment.includes("\u0000"),
    );
}

/** 화면 틀이 읽을 자리. 작업 폴더 안의 상대 경로면 `{root, entry}`로, 그 밖이면 root 없이 이름만 준다 */
export function frameSourceOf(
  path: string,
  workspace: string | null,
): { readonly root: string | null; readonly entry: string } {
  const clean = normalizeArtifactPath(path, workspace);
  if (workspace !== null && workspace !== "" && isSafeRelativePath(clean)) {
    return { root: workspace, entry: clean };
  }
  return { root: null, entry: lastSegmentOf(clean) };
}

/** 마지막 버전의 본문. 버전이 없으면 null */
function latestText(draft: Draft): string | null {
  return draft.versions.at(-1)?.text ?? null;
}

function draftOf(
  drafts: Map<string, Draft>,
  key: string,
  source: ArtifactSource,
  kind: ArtifactKind,
  title: string,
): Draft {
  const existing = drafts.get(key);
  if (existing !== undefined) return existing;
  const draft: Draft = { key, source, kind, title, versions: [], pending: false };
  drafts.set(key, draft);
  return draft;
}

function addVersion(draft: Draft, call: Call, op: ArtifactOp, text: string | null): void {
  draft.versions.push({
    number: draft.versions.length + 1,
    callId: call.callId,
    itemId: call.itemId,
    op,
    text,
  });
}

function applyFileCall(
  drafts: Map<string, Draft>,
  call: Call,
  result: CallResult | null,
  workspace: string | null,
): void {
  const target = fileTargetOf(call.args, workspace);
  if (target === null) return;
  const draft = draftOf(
    drafts,
    `file:${target.path}`,
    { kind: "file", path: target.path },
    target.kind,
    lastSegmentOf(target.path),
  );
  if (result === null) {
    draft.pending = true;
    return;
  }
  if (result.isError) return;
  if (call.name === "write") {
    addVersion(draft, call, "write", stringField(call.args, "content"));
    return;
  }
  // 편집은 앞 버전에 대고 적용한다. 앞 버전이 없으면(파일이 대화 전에 있었다) 본문을 모른다
  const prev = latestText(draft);
  const edits = editsOfArgs(call.args);
  const text = prev === null || edits === null ? null : applyEdits(prev, edits);
  addVersion(draft, call, "edit", text);
}

function applyCreate(drafts: Map<string, Draft>, call: Call, result: CallResult | null): void {
  const kind = createKindOf(call.args);
  if (kind === null || result === null || result.isError) return;
  const artifactId = registeredIdOf(result.details, result.text);
  if (artifactId === null) return;
  const title = stringField(call.args, "title") ?? artifactId;
  const draft = draftOf(
    drafts,
    `art:${artifactId}`,
    { kind: "registered", artifactId },
    kind,
    title,
  );
  draft.kind = kind;
  draft.title = title;
  addVersion(draft, call, "create", stringField(call.args, "text"));
}

function applyUpdate(drafts: Map<string, Draft>, call: Call, result: CallResult | null): void {
  // 처음 만든 호출이 대화에 있어야 한다. 없는 산출물의 갱신은 버릴 수밖에 없다
  const artifactId = idField(call.args, "artifactId");
  const draft = artifactId === null ? undefined : drafts.get(`art:${artifactId}`);
  if (draft === undefined) return;
  if (result === null) {
    draft.pending = true;
    return;
  }
  if (result.isError) return;
  const mediaType = stringField(call.args, "mediaType");
  const viewable = mediaType === null ? null : artifactKindOfMediaType(mediaType);
  const text = stringField(call.args, "text") ?? latestText(draft);
  draft.kind = viewable ?? draft.kind;
  draft.title = stringField(call.args, "title") ?? draft.title;
  addVersion(draft, call, "update", text);
}

function applyCall(
  drafts: Map<string, Draft>,
  call: Call,
  result: CallResult | null,
  workspace: string | null,
): void {
  if (call.name === "write" || call.name === "edit") {
    applyFileCall(drafts, call, result, workspace);
  } else if (call.name === "artifact_create") {
    applyCreate(drafts, call, result);
  } else if (call.name === "artifact_update") {
    applyUpdate(drafts, call, result);
  }
}

function entryOf(draft: Draft): ArtifactEntry {
  return {
    key: draft.key,
    source: draft.source,
    kind: draft.kind,
    title: draft.title,
    versions: [...draft.versions],
    pending: draft.pending,
  };
}

/** 열린 대화의 확정 item에서 산출물 목록을 만든다(처음 나온 순서). 버전도 대기도 없는 산출물은 뺀다 */
export function artifactsOf(input: {
  readonly itemIds: readonly ItemId[];
  readonly items: Readonly<Record<string, ItemRecord>>;
  readonly workspace: string | null;
}): readonly ArtifactEntry[] {
  const results = resultsOf(input.itemIds, input.items);
  const drafts = new Map<string, Draft>();
  for (const itemId of input.itemIds) {
    const item = input.items[itemId];
    if (item?.kind !== "assistant") continue;
    for (const block of item.message.content) {
      if (block.type !== "toolCall") continue;
      const call: Call = { callId: block.id, itemId, name: block.name, args: block.arguments };
      applyCall(drafts, call, results.get(block.id) ?? null, input.workspace);
    }
  }
  return [...drafts.values()]
    .filter((draft) => draft.versions.length > 0 || draft.pending)
    .map(entryOf);
}

/** 도구 호출이 속한 산출물 키(채팅 카드용). 속하지 않으면 null. 결과가 없으면 결과 자리는 null로 준다 */
export function artifactKeyOfCall(input: {
  readonly name: string;
  readonly args: unknown;
  readonly resultDetails: JsonValue | null;
  readonly resultText: string | null;
  readonly workspace: string | null;
}): string | null {
  if (input.name === "write" || input.name === "edit") {
    const target = fileTargetOf(input.args, input.workspace);
    return target === null ? null : `file:${target.path}`;
  }
  if (input.name === "artifact_create") {
    if (createKindOf(input.args) === null) return null;
    const artifactId = registeredIdOf(input.resultDetails, input.resultText);
    return artifactId === null ? null : `art:${artifactId}`;
  }
  if (input.name === "artifact_update") {
    const artifactId = idField(input.args, "artifactId");
    return artifactId === null ? null : `art:${artifactId}`;
  }
  return null;
}

/** HTML·SVG 글 안의 절대 http(s) 주소에서 호스트를 뽑는다. 이름 공간 주소(www.w3.org)는 뺀다. 처음 나온 순서, 최대 8개 */
export function externalHostsOf(text: string): readonly string[] {
  const hosts: string[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    if (hosts.length >= MAX_LIST) break;
    // 문장 끝의 구두점은 주소가 아니다
    const parsed = attempt(() => new URL(match[0].replace(/[.,;:]+$/, "")));
    if (!parsed.ok) continue;
    const host = parsed.value.hostname.toLowerCase();
    if (host === "" || host === W3_HOST || hosts.includes(host)) continue;
    hosts.push(host);
  }
  return hosts;
}

function leavesFolder(ref: string): boolean {
  return (
    ref.startsWith("../") ||
    (ref.startsWith("/") && !ref.startsWith("//")) ||
    ref.toLowerCase().startsWith("file:")
  );
}

/** HTML·SVG 글의 참조(src, href, url(), @import) 가운데 폴더 밖을 가리키는 것. 처음 나온 순서, 최대 8개 */
export function outsideRefsOf(text: string): readonly string[] {
  const refs: string[] = [];
  for (const match of text.matchAll(REF_PATTERN)) {
    if (refs.length >= MAX_LIST) break;
    const groups: readonly (string | undefined)[] = match.slice(1);
    const value = groups.find((group) => group !== undefined)?.trim() ?? "";
    if (value === "" || !leavesFolder(value) || refs.includes(value)) continue;
    refs.push(value);
  }
  return refs;
}
