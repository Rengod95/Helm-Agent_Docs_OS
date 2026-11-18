import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { attemptAsync, err, ok, parse, parseJson, type Result } from "@fresnel/contracts";
import { JsonValueSchema, type JsonValue } from "@fresnel/contracts/conversation";
import { validateManifest } from "@fresnel/contracts/extensions";
import type { BacktestCandidate } from "@fresnel/contracts/wire";
import { parseReviewKey } from "../plugins/review-key.ts";
import type { PluginStore } from "../plugins/store.ts";

// 지난 턴에 돌려 보기의 후보 찾기(turn-record-metrics.md §4.8 규칙 54). `versionId`로 검토본 트리 또는 초안 트리를 고른다.
// 검토본은 저장소의 `treePath`와 무결성 검사를, 초안은 초안 정보 파일(`readDraft`)의 이름과 해시 앞 8 hex를 맞춘다.
// 매니페스트는 `validateManifest`로 읽는다(외부 확장 적재와 같은 검사). 코드는 읽지도 실행하지도 않는다.

/** 검토본 해시(`sha256:<64 hex>`)와 초안 버전(`draft:<초안 id>:<해시 앞 8 hex>`)의 모양 */
const REVIEWED_VERSION = /^sha256:[0-9a-f]{64}$/;
const DRAFT_VERSION = /^draft:([A-Za-z0-9_-]{1,64}):([0-9a-f]{8})$/;
const CONTENT_HASH = /^sha256:([0-9a-f]{64})$/;
const MANIFEST_PATH = [".fresnel-plugin", "plugin.json"] as const;

/** 찾은 후보. `entry`가 null이면 코드가 없는 후보(Inject 전용)다 */
interface ResolvedCandidate {
  readonly name: string;
  readonly versionId: string;
  /** 후보 패키지 폴더 절대 경로(검토본 `tree/`, 초안 `drafts/<id>/tree/`) */
  readonly root: string;
  /** 매니페스트 문서 그대로(JSON 값) */
  readonly manifest: JsonValue;
  readonly entry: string | null;
}

/** 후보를 찾지 못했다. 이유 문장은 사람이 읽을 용도다(와이어 오류는 `3521`이다) */
export interface CandidateResolveError {
  readonly kind: "candidate_not_found";
  readonly message: string;
}

/** 후보 찾기가 쓰는 저장소 면. 전체 `PluginStore`를 들고 다니지 않는다 */
export type CandidateStoreView = Pick<
  PluginStore,
  "treePath" | "verifyIntegrity" | "readDraft" | "draftDir"
>;

/** 매니페스트 파일 읽기. 없으면 `null`이다. 다른 읽기 실패는 메시지로 돌려준다 */
type ReadManifestText = (path: string) => Promise<Result<string | null, string>>;

export type CandidateResolver = (
  candidate: BacktestCandidate,
) => Promise<Result<ResolvedCandidate, CandidateResolveError>>;

export interface CandidateResolverDeps {
  readonly store: CandidateStoreView;
  readonly readManifestText: ReadManifestText;
}

function notFound(message: string): Result<never, CandidateResolveError> {
  return err({ kind: "candidate_not_found", message });
}

/** 매니페스트 파일을 읽어 검사한다. 원본 JSON 값과 확장 이름, 진입점을 돌려준다 */
async function manifestOf(
  root: string,
  deps: CandidateResolverDeps,
): Promise<
  Result<
    { readonly raw: JsonValue; readonly name: string; readonly entry: string | null },
    CandidateResolveError
  >
> {
  const text = await deps.readManifestText(join(root, ...MANIFEST_PATH));
  if (!text.ok) return notFound(`the manifest cannot be read: ${text.error}`);
  if (text.value === null) return notFound("the candidate has no manifest");
  const json = parseJson(text.value);
  if (!json.ok) return notFound("the manifest is not JSON");
  const raw = parse(JsonValueSchema, json.value);
  if (!raw.ok) return notFound("the manifest is not a JSON value");
  const checked = validateManifest(json.value);
  if (checked.manifest === undefined) {
    const first = checked.issues[0];
    return notFound(`the manifest is invalid: ${first?.message ?? "unknown issue"}`);
  }
  return ok({ raw: raw.value, name: checked.manifest.name, entry: checked.manifest.entry ?? null });
}

/** 후보 찾기 함수를 만든다. 실행기와 프로세스를 여기서 다루지 않는다 */
export function createCandidateResolver(deps: CandidateResolverDeps): CandidateResolver {
  async function reviewed(
    pluginId: string,
    name: string,
    versionId: string,
  ): Promise<Result<ResolvedCandidate, CandidateResolveError>> {
    const tree = await deps.store.treePath(pluginId, versionId);
    if (!tree.ok) return notFound(`the reviewed version is missing: ${tree.error.kind}`);
    const integrity = await deps.store.verifyIntegrity(pluginId, versionId);
    if (!integrity.ok)
      return notFound(`the reviewed version does not verify: ${integrity.error.kind}`);
    return withManifest(tree.value, name, versionId);
  }

  async function draft(
    name: string,
    versionId: string,
    draftId: string,
    prefix: string,
  ): Promise<Result<ResolvedCandidate, CandidateResolveError>> {
    const info = await deps.store.readDraft(draftId);
    if (!info.ok) return notFound(`the draft is missing: ${info.error.kind}`);
    if (info.value.name !== name) return notFound("the draft belongs to another plugin");
    const hash = CONTENT_HASH.exec(info.value.contentHash);
    if (hash?.[1]?.slice(0, 8) !== prefix)
      return notFound("the draft hash does not match the version");
    return withManifest(join(deps.store.draftDir(draftId), "tree"), name, versionId);
  }

  async function withManifest(
    root: string,
    name: string,
    versionId: string,
  ): Promise<Result<ResolvedCandidate, CandidateResolveError>> {
    const found = await manifestOf(root, deps);
    if (!found.ok) return found;
    if (found.value.name !== name) return notFound("the manifest name is not the candidate's name");
    return ok({ name, versionId, root, manifest: found.value.raw, entry: found.value.entry });
  }

  return async (candidate) => {
    const parts = parseReviewKey(candidate.pluginId);
    if (!parts.ok) return notFound("the candidate plugin id is malformed");
    if (REVIEWED_VERSION.test(candidate.versionId)) {
      return reviewed(candidate.pluginId, parts.value.name, candidate.versionId);
    }
    const draftMatch = DRAFT_VERSION.exec(candidate.versionId);
    if (draftMatch !== null) {
      const draftId = draftMatch[1];
      const prefix = draftMatch[2];
      if (draftId === undefined || prefix === undefined)
        return notFound("the version id is malformed");
      return draft(parts.value.name, candidate.versionId, draftId, prefix);
    }
    return notFound("the version id is neither a reviewed hash nor a draft");
  };
}

/** 매니페스트를 디스크에서 읽는다. 파일이 없으면 `null`이다 */
export async function readManifestFile(path: string): Promise<Result<string | null, string>> {
  const text = await attemptAsync(() => readFile(path, "utf8"));
  if (text.ok) return ok(text.value);
  const code: unknown = text.error.cause;
  if (typeof code === "object" && code !== null && "code" in code && code.code === "ENOENT") {
    return ok(null);
  }
  return err("the file cannot be read");
}
