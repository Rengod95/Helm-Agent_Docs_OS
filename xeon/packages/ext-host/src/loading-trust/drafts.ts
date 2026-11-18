// 초안(플러그인 draft) 적재의 이름과 입출력 모양(X.loading-trust.spec §4.9.8 [제안]). 초안 트리는 플러그인 저장소의
// `drafts/<draftId>/tree`에 있고 격리 프로세스에서만 돈다. 등록과 ExtHost 설치는 검토본과 겹치지 않도록 내부 이름으로 한다.
import type { ExtensionManifest, ExtensionName } from "@fresnel/contracts/extensions";
import type { LoadDiagnostic } from "./pipeline.ts";

/** 내부 이름의 첫 글자. 확장 이름 패턴이 소문자로 시작하므로 `d`로 시작한다 [제안] */
const DRAFT_NAME_PREFIX = "d";
/** 초안 식별자에서 가져오는 영숫자 글자 수 [제안] */
const DRAFT_TAG_LENGTH = 6;
/** 확장 이름의 최대 길이(`EXTENSION_NAME_PATTERN`의 `{1,31}`에 맞춘 32자) */
const EXTENSION_NAME_MAX = 32;

/**
 * 초안의 내부 확장 이름 [제안]: `d` + 초안 식별자의 소문자 영숫자 앞 여섯 글자 + `-` + 플러그인 이름.
 * 플러그인 이름 부분은 전체가 32자를 넘지 않도록 자른다. 잘라서 같은 이름이 되면 로더가 `name_taken`으로 거부한다.
 */
export function internalDraftName(plugin: string, draftId: string): string {
  const tag = draftId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, DRAFT_TAG_LENGTH);
  const head = `${DRAFT_NAME_PREFIX}${tag}-`;
  return `${head}${plugin.slice(0, EXTENSION_NAME_MAX - head.length)}`;
}

/**
 * 초안 출처. 로더 후보(`ExtensionCandidate.draft`)에 붙어 내부 이름과 판 식별자를 정한다. 로더 밖으로는 `DraftInfo`로 나간다.
 */
export interface DraftOrigin {
  /** 저장소의 플러그인 이름(매니페스트 이름과 같아야 한다) */
  readonly plugin: ExtensionName;
  readonly draftId: string;
  /** 설치와 등록에 쓰는 이름(`internalDraftName`) */
  readonly internalName: ExtensionName;
  /** 초안 트리의 내용 해시(`sha256:<hex>`) */
  readonly contentHash: string;
}

/** `loadDraft` 입력. `root`는 초안 트리(`drafts/<draftId>/tree`)이고 `contentHash`는 그 트리의 해시다 */
export interface DraftLoadInput {
  readonly plugin: string;
  readonly draftId: string;
  readonly root: string;
  readonly contentHash: string;
  /** 트리에 매니페스트 파일이 없을 때 쓰는 추론 매니페스트(검토본과 같은 규칙). 파일이 있으면 파일이 이긴다 */
  readonly manifest?: ExtensionManifest;
}

/** 실린 초안 하나. 내부 이름으로 찾는다(`ExtensionLoader.draftOf`) */
export interface DraftInfo {
  readonly internalName: ExtensionName;
  readonly plugin: string;
  readonly draftId: string;
  readonly contentHash: string;
}

/**
 * `loadDraft`가 싣지 못한 이유. 실패하면 호스트에 아무것도 남지 않는다(기록도 설치도 없다).
 */
export type LoadDraftFailure =
  /** 격리 포트(`process`)나 띄우기 설정(`isolation`)이 없다. 초안은 엔진 안에서 돌지 않으므로 싣지 않는다 */
  | { readonly kind: "isolation_unavailable" }
  /** 같은 플러그인과 초안 식별자가 이미 실려 있다 */
  | { readonly kind: "already_loaded" }
  /** 내부 이름을 다른 확장이나 다른 초안이 쓴다(이름을 잘라 겹칠 수 있다) */
  | { readonly kind: "name_taken"; readonly internalName: ExtensionName }
  /** 안전 모드라 싣지 않는다 */
  | { readonly kind: "safe_mode" }
  /** 초안 트리에 매니페스트도 추론 매니페스트도 없다 */
  | { readonly kind: "not_found"; readonly diagnostics: readonly LoadDiagnostic[] }
  /** 파이프라인이 거부했거나(`rejected`, `error`) 꺼진 채 두었다(`disabled`). 초안은 꺼진 기록을 남기지 않는다 */
  | {
      readonly kind: "not_active";
      readonly state: "rejected" | "disabled" | "error";
      readonly diagnostics: readonly LoadDiagnostic[];
    };

/**
 * 초안의 판 식별자 `draft:<draftId>:<해시 앞 8자>`(F.extensions의 `versionId` 모양, X.loading-trust.spec §4.9.8 [제안]).
 * 격리 세션의 라벨과 `host.init`의 `versionId`에 쓴다
 */
export function draftVersionIdOf(origin: Pick<DraftOrigin, "draftId" | "contentHash">): string {
  const prefix = "sha256:";
  const hex = origin.contentHash.slice(prefix.length, prefix.length + 8);
  return `draft:${origin.draftId}:${hex}`;
}
