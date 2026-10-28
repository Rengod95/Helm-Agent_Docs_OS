import type { TurnOutcome } from "@xeon/contracts/extensions";
import { WorkTasksKey } from "@xeon/contracts/capabilities";
import type { GroupApi } from "@xeon/group-kit";
import { callSource } from "./knowledge.ts";
import { jsonOf, type DiscoveryRecordedPayload, type InquiryFinishedPayload } from "./records.ts";
import type { HelmFailure } from "./failures.ts";
import type { HelmState, InquiryId } from "./state.ts";

type OutputApi = Pick<GroupApi<HelmState>, "record" | "capability">;

/** 작업 연결 requestId. 64자 이하 */
export function taskRequestId(inquiryId: InquiryId, findingId: string): string {
  return `helm:${inquiryId}:cap:task:${findingId}`;
}

/**
 * 발견마다 grp.helm.discovery.recorded 1건을 쓴다(L3.helm.spec §4.8). `applied`는 적용 turn이 completed면 참이다.
 * 커밋 전에 끊겨 다시 불리면 같은 발견을 다시 기록할 수 있다. 읽는 쪽이 (inquiryId, findingId)로 중복을 지운다
 */
export async function recordDiscoveries(
  g: Pick<OutputApi, "record">,
  state: Readonly<HelmState>,
  inquiryId: InquiryId,
  applied: TurnOutcome | undefined,
): Promise<void> {
  const subject =
    applied?.status === "completed"
      ? ({ type: "turn", id: applied.turnId } as const)
      : ({ type: "external", id: inquiryId } as const);
  await Promise.all(
    state.findings.map((finding) => {
      const payload: DiscoveryRecordedPayload = {
        inquiryId,
        lens: finding.lensId,
        claim: finding.claim,
        sources: finding.sources,
        applied: applied?.status === "completed",
        confidence: finding.confidence,
        findingId: finding.id,
      };
      return g.record("grp.helm.discovery.recorded", subject, jsonOf(payload));
    }),
  );
}

/** 탐구 종료 1건. drive에는 thread id가 없어 subject는 탐구 id의 external이다 */
export function recordFinished(
  g: Pick<OutputApi, "record">,
  finished: InquiryFinishedPayload,
): Promise<void> {
  return g.record(
    "grp.helm.inquiry.finished",
    { type: "external", id: finished.inquiryId },
    jsonOf(finished),
  );
}

export interface LinkWorkResult {
  /** 발견 id → 만든 작업 id. 실패한 발견은 없다 */
  readonly tasks: ReadonlyMap<string, string>;
  /** 임대가 회수돼 남은 호출을 멈췄다 */
  readonly leaseLost: boolean;
  /** 능력 실패로 건너뛴 발견 수 */
  readonly skipped: number;
}

/**
 * followUp이 있는 발견마다 work.tasks.create를 부른다. 멱등 쓰기이고 requestId는 탐구 id와 발견 id에서 만든다.
 * 능력 실패는 그 발견만 건너뛰고, 임대 회수면 남은 호출을 멈춘다
 */
export async function linkWork(
  g: Pick<OutputApi, "capability">,
  state: Readonly<HelmState>,
  inquiryId: InquiryId,
  opts: { readonly signal: AbortSignal },
): Promise<LinkWorkResult> {
  const tasks = new Map<string, string>();
  let skipped = 0;
  const todo = state.findings.filter((finding) => finding.followUp !== undefined);
  const outcome = await linkFrom(g, todo, 0, inquiryId, opts, tasks);
  skipped = outcome.skipped;
  return { tasks, leaseLost: outcome.leaseLost, skipped };
}

async function linkFrom(
  g: Pick<OutputApi, "capability">,
  todo: HelmState["findings"],
  index: number,
  inquiryId: InquiryId,
  opts: { readonly signal: AbortSignal },
  tasks: Map<string, string>,
): Promise<{ readonly leaseLost: boolean; readonly skipped: number }> {
  const finding = todo[index];
  if (finding === undefined) return { leaseLost: false, skipped: 0 };
  const content = finding.followUp ?? "";
  const created = await callSource("work.tasks", () =>
    g
      .capability(WorkTasksKey)
      .create(
        { content },
        { requestId: taskRequestId(inquiryId, finding.id), signal: opts.signal },
      ),
  );
  if (!created.ok) return linkFailure(g, todo, index, inquiryId, opts, tasks, created.error);
  tasks.set(finding.id, created.value.task.id);
  return linkFrom(g, todo, index + 1, inquiryId, opts, tasks);
}

async function linkFailure(
  g: Pick<OutputApi, "capability">,
  todo: HelmState["findings"],
  index: number,
  inquiryId: InquiryId,
  opts: { readonly signal: AbortSignal },
  tasks: Map<string, string>,
  failure: Extract<HelmFailure, { kind: "capability" | "lease_lost" }>,
): Promise<{ readonly leaseLost: boolean; readonly skipped: number }> {
  if (failure.kind === "lease_lost") return { leaseLost: true, skipped: 0 };
  const rest = await linkFrom(g, todo, index + 1, inquiryId, opts, tasks);
  return { leaseLost: rest.leaseLost, skipped: rest.skipped + 1 };
}
