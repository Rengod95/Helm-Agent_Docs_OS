import type { MessageId } from "@fresnel/client/i18n";
import type { ItemId } from "@fresnel/contracts/conversation";
import type { ArtifactFrameErrorKind, ArtifactFrameRequest } from "./artifact-frames.ts";
import {
  frameSourceOf,
  type ArtifactEntry,
  type ArtifactKind,
  type ArtifactVersion,
} from "./artifact-model.ts";

// 아티팩트 판의 순수 값(artView). 어느 아티팩트와 판을 보일지, 셸 프레임에 무엇을 읽게 할지 정한다. 화면 없이 시험한다.

/** 가둔 틀의 sandbox 토큰. `allow-same-origin`을 주지 않는다: 프레임은 불투명 출처라 앱 저장소, 쿠키, 부모 화면에 닿지 못한다 */
export const ARTIFACT_FRAME_SANDBOX = "allow-scripts" as const;

/** 아티팩트 종류의 이름 글(판 머리, 대화 카드) */
export const ARTIFACT_KIND_LABEL: Readonly<Record<ArtifactKind, MessageId>> = {
  html: "desktop.artifact.kind.html",
  svg: "desktop.artifact.kind.svg",
  image: "desktop.artifact.kind.image",
  markdown: "desktop.artifact.kind.markdown",
};

/** 셸이 프레임을 열지 못한 까닭의 글. 폴더가 너무 넓거나 파일이 너무 크면 따로 알리고, 나머지는 한 글로 묶는다 */
export const FRAME_ERROR_NOTE: Readonly<Record<ArtifactFrameErrorKind, MessageId>> = {
  too_broad: "desktop.artifact.note.tooBroad",
  too_large: "desktop.artifact.note.tooLarge",
  bad_entry: "desktop.artifact.note.frameFailed",
  forbidden_type: "desktop.artifact.note.frameFailed",
  not_absolute: "desktop.artifact.note.frameFailed",
  not_a_directory: "desktop.artifact.note.frameFailed",
  no_source: "desktop.artifact.note.frameFailed",
  unavailable: "desktop.artifact.note.frameFailed",
};

/** 판이 그릴 수 없을 때 보이는 글 */
type FrameNoteId =
  | "desktop.artifact.note.pending"
  | "desktop.artifact.note.noText"
  | "desktop.artifact.note.noPreview"
  | "desktop.artifact.note.remote";

/**
 * 셸 프레임 계획. `stamp`는 같은 요청이라도 새 판이 생기면 새 프레임을 열게 하는 표지다(최신 판은 디스크에서 읽어 요청 글이 같다)
 */
export type FramePlan =
  | { readonly kind: "frame"; readonly request: ArtifactFrameRequest; readonly stamp: string }
  | { readonly kind: "none"; readonly reason: FrameNoteId };

/** 그림 판(SVG, 그림)은 셸이 만든 작은 HTML 안의 `<img>`로 그린다. SVG도 `<img>`라 그 안의 스크립트는 돌지 않는다 */
function wrapOf(kind: ArtifactKind): ArtifactFrameRequest["wrap"] {
  return kind === "svg" || kind === "image" ? "image" : "none";
}

const REGISTERED_ENTRY: Readonly<Record<ArtifactKind, string | null>> = {
  html: "artifact.html",
  svg: "artifact.svg",
  markdown: "artifact.md",
  image: null,
};

/**
 * 판 하나를 셸 프레임 요청으로 바꾼다. `local`은 이 컴퓨터의 엔진에 붙어 있고 셸이 있다는 뜻이다(그때만 프로젝트 폴더를 읽는다).
 * - 파일 아티팩트의 최신 판: 프로젝트 폴더의 파일을 그대로 읽는다(모델이 명령으로 바꾼 것도 보인다). 같은 폴더의 상대 경로 자원도 읽힌다.
 * - 지난 판: 대화 기록에서 다시 만든 글을 본문으로 주고, 상대 경로 자원은 폴더에서 읽는다.
 * - 폴더 밖 파일, 원격 엔진, 등록 아티팩트: 대화 기록의 글만 준다(폴더를 읽지 않는다).
 */
export function frameRequestOf(input: {
  readonly entry: ArtifactEntry;
  readonly version: ArtifactVersion | undefined;
  readonly workspace: string | null;
  readonly local: boolean;
}): FramePlan {
  const { entry, version } = input;
  if (version === undefined) return { kind: "none", reason: "desktop.artifact.note.pending" };
  const wrap = wrapOf(entry.kind);
  const stamp = version.callId;
  if (entry.source.kind === "registered") {
    const name = REGISTERED_ENTRY[entry.kind];
    if (name === null || version.text === null) {
      return { kind: "none", reason: "desktop.artifact.note.noText" };
    }
    return { kind: "frame", request: { root: null, entry: name, text: version.text, wrap }, stamp };
  }
  const source = frameSourceOf(entry.source.path, input.workspace);
  const latest = version.number === entry.versions.length;
  if (input.local && source.root !== null) {
    if (latest) {
      return {
        kind: "frame",
        request: { root: source.root, entry: source.entry, text: null, wrap },
        stamp,
      };
    }
    if (version.text === null) return { kind: "none", reason: "desktop.artifact.note.noText" };
    return {
      kind: "frame",
      request: { root: source.root, entry: source.entry, text: version.text, wrap },
      stamp,
    };
  }
  if (version.text === null || entry.kind === "image") {
    return {
      kind: "none",
      reason: input.local ? "desktop.artifact.note.noText" : "desktop.artifact.note.remote",
    };
  }
  return {
    kind: "frame",
    request: { root: null, entry: source.entry, text: version.text, wrap },
    stamp,
  };
}

/** 가장 최근에 바뀐 아티팩트. 마지막 판을 낸 item이 대화에서 가장 뒤인 것이다. 없으면 undefined */
export function latestArtifactOf(
  list: readonly ArtifactEntry[],
  itemIds: readonly ItemId[],
): ArtifactEntry | undefined {
  const at = new Map<ItemId, number>();
  for (const [index, id] of itemIds.entries()) at.set(id, index);
  let best: ArtifactEntry | undefined;
  let bestAt = -2;
  for (const entry of list) {
    const last = entry.versions.at(-1);
    const position = last === undefined ? -1 : (at.get(last.itemId) ?? -1);
    if (position >= bestAt) {
      best = entry;
      bestAt = position;
    }
  }
  return best;
}

/** 보일 판. 고른 번호가 없거나 범위 밖이면 최신 판이다. 판이 아직 없으면 undefined */
export function versionOf(entry: ArtifactEntry, want: number | null): ArtifactVersion | undefined {
  if (want !== null && want >= 1 && want <= entry.versions.length) {
    return entry.versions[want - 1];
  }
  return entry.versions.at(-1);
}

/** 도구 호출 하나가 만든 판(대화 카드가 그 판을 연다). 그 호출이 판이 아니면 undefined */
export function versionOfCall(
  list: readonly ArtifactEntry[],
  callId: string,
): { readonly entry: ArtifactEntry; readonly version: ArtifactVersion } | undefined {
  for (const entry of list) {
    const version = entry.versions.find((v) => v.callId === callId);
    if (version !== undefined) return { entry, version };
  }
  return undefined;
}

/**
 * 폴더 밖 참조(`outsideRefsOf`) 가운데 실제로 작업 폴더를 벗어나는 것만 남긴다. `../`는 `entry`가 있는 폴더 깊이보다 많이 올라갈 때만
 * 밖이다(`site/index.html`의 `../a.css`는 폴더 안이다). `/`로 시작하는 주소와 `file:`은 늘 밖이다. 폴더 없이 그리는 판(`root` null)은
 * 상대 참조가 모두 읽히지 않으므로 그대로 둔다
 */
export function escapingRefsOf(
  refs: readonly string[],
  source: { readonly root: string | null; readonly entry: string },
): readonly string[] {
  if (source.root === null) return refs;
  const depth = source.entry.split("/").length - 1;
  return refs.filter((ref) => {
    if (!ref.startsWith("../")) return true;
    let level = depth;
    for (const segment of ref.split("/")) {
      if (segment === "..") level -= 1;
      else if (segment !== "." && segment !== "") level += 1;
      if (level < 0) return true;
    }
    return false;
  });
}
