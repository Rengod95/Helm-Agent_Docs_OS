import { attemptAsync, err, ok, rethrow, type Result } from "@xeon/contracts";
import {
  KnowledgeMemoryKey,
  KnowledgeSearchKey,
  WebSearchKey,
  type CapabilityId,
} from "@xeon/contracts/capabilities";
import type { GroupApi } from "@xeon/group-kit";
import { failureOf, type HelmFailure } from "./failures.ts";
import type { HelmSource, HelmState, InquiryId } from "./state.ts";

export interface KnowledgeDigest {
  readonly sources: readonly HelmSource[];
  /** 저하 동작으로 빠진 경로 */
  readonly degraded: readonly ("web" | "knowledge" | "session")[];
}

export interface ActiveInquiryView {
  readonly inquiryId: InquiryId;
  readonly topic: string;
  readonly round: number;
}

type KnowledgeApi = Pick<GroupApi<HelmState>, "capability">;

type SourceFailure = Extract<HelmFailure, { kind: "capability" | "lease_lost" }>;

/**
 * 출처 하나의 호출 결과. 예외를 받아 HelmFailure로 바꾼다. 능력 실패와 임대 회수만 값으로 돌려주고
 * 그 밖의 예외(타입 위반, Bug)는 다시 던진다. 오류를 삼키지 않는다
 */
export async function callSource<T>(
  capability: CapabilityId,
  call: () => Promise<T>,
): Promise<Result<T, SourceFailure>> {
  const called = await attemptAsync(call);
  if (called.ok) return ok(called.value);
  const failure = failureOf(called.error.cause, { capability });
  if (failure === undefined || (failure.kind !== "capability" && failure.kind !== "lease_lost")) {
    return rethrow(called.error.cause);
  }
  return err(failure);
}

/** 순수 함수. capability 실패 → 저하 동작 분류. 임대 회수면 남은 호출을 멈춘다 */
export function degradeOf(failure: SourceFailure): "skip" | "abort" {
  return failure.kind === "lease_lost" ? "abort" : "skip";
}

const REF_MAX = 512;
const TITLE_MAX = 80;
const QUERY_MAX = 256;
const SOURCES_MAX = 8;

function sourceOf(
  origin: HelmSource["origin"],
  ref: string,
  title: string | undefined,
): HelmSource {
  const trimmedTitle = title?.slice(0, TITLE_MAX);
  return {
    origin,
    ref: ref.slice(0, REF_MAX),
    ...(trimmedTitle === undefined || trimmedTitle === "" ? {} : { title: trimmedTitle }),
  };
}

type Gathered = { readonly sources: readonly HelmSource[]; readonly aborted: boolean };

/**
 * drive 안에서만 부른다. 각 호출은 읽기 메서드라 requestId를 넘기지 않는다. 실패는 출처별로 저하 동작으로 바꾸고
 * 이 함수는 실패하지 않는다. 순서: 스킬 검색, 메모리, 과거 대화, 웹(L3.helm.spec §4.7)
 */
export async function gatherContext(
  g: KnowledgeApi,
  inquiry: ActiveInquiryView,
  opts: { readonly signal: AbortSignal },
): Promise<KnowledgeDigest> {
  const { signal } = opts;
  const query = inquiry.topic.slice(0, QUERY_MAX);
  const degraded: ("web" | "knowledge" | "session")[] = [];
  const sources: HelmSource[] = [];

  const run = async (
    capability: CapabilityId,
    kind: "web" | "knowledge" | "session",
    call: () => Promise<readonly HelmSource[]>,
  ): Promise<boolean> => {
    const result = await callSource(capability, call);
    if (result.ok) {
      sources.push(...result.value);
      return true;
    }
    if (!degraded.includes(kind)) degraded.push(kind);
    return degradeOf(result.error) === "skip";
  };

  const steps: readonly (() => Promise<boolean>)[] = [
    () =>
      run("knowledge.search", "knowledge", async () => {
        const out = await g
          .capability(KnowledgeSearchKey)
          .query({ query, kinds: ["skill"], limit: 3 }, { signal });
        return out.hits.map((hit) => sourceOf("knowledge", `skill:${hit.ref}`, hit.title));
      }),
    () =>
      run("knowledge.memory", "knowledge", async () => {
        const out = await g.capability(KnowledgeMemoryKey).read({}, { signal });
        return out.stores
          .filter((store) => store.entries.length > 0)
          .map((store) =>
            sourceOf(
              "knowledge",
              `memory:${store.store}`,
              `메모리 ${store.store} ${String(store.entries.length)}항목`,
            ),
          );
      }),
    () =>
      run("knowledge.search", "session", async () => {
        const out = await g
          .capability(KnowledgeSearchKey)
          .query({ query, kinds: ["session"], limit: 3 }, { signal });
        return out.hits.map((hit) => sourceOf("session", `session:${hit.ref}`, hit.title));
      }),
    () =>
      run("web.search", "web", async () => {
        const out = await g
          .capability(WebSearchKey)
          .search(
            { query: inquiry.topic.slice(0, 512), limit: 5, content: "highlights" },
            { signal },
          );
        return out.results.map((result) => sourceOf("web", result.url, result.title));
      }),
  ];
  const gathered = await runSteps(steps, 0, { sources, aborted: false });
  return { sources: gathered.sources.slice(0, SOURCES_MAX), degraded };
}

async function runSteps(
  steps: readonly (() => Promise<boolean>)[],
  index: number,
  state: Gathered,
): Promise<Gathered> {
  const step = steps[index];
  if (step === undefined) return state;
  const proceed = await step();
  if (!proceed) return { sources: state.sources, aborted: true };
  return runSteps(steps, index + 1, state);
}
