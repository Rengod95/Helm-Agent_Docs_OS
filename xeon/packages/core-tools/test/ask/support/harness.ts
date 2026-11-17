import type { LogFields, Logger } from "@fresnel/contracts";
import type { CallOptions } from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import type { AskDeps } from "../../../src/ask/deps.ts";
import { manualTimers, type ManualTimers, type RealApprovals } from "../../../src/testing/index.ts";

// 질문 시험의 대역 조립. cap-dialog 시험 `harness`에서 질문 서비스가 읽는 의존만 옮겼다(AskDeps).
// 설정은 cap-dialog 기본값과 같다(시간 제한 0, 제한 없음). 설정 층을 읽는 시험은 cap-dialog에 남는다.

interface LogLine {
  readonly event: string;
  readonly fields: LogFields | undefined;
}

function recordingLogger(lines: LogLine[]): Logger {
  const logger: Logger = {
    debug: (event, fields) => void lines.push({ event, fields }),
    info: (event, fields) => void lines.push({ event, fields }),
    warn: (event, fields) => void lines.push({ event, fields }),
    error: (event, fields) => void lines.push({ event, fields }),
    child: () => logger,
  };
  return logger;
}

const ids = fixedIdFactory(5000);

/** 시험마다 새 스레드 id */
export function newThread(): ThreadId {
  return ids.next("thr");
}

/** 대화 문맥과 requestId를 실은 호출 옵션 */
export function callOptions(
  threadId: ThreadId,
  extra: { readonly requestId?: string; readonly signal?: AbortSignal } = {},
): CallOptions {
  return {
    context: { threadId, caller: { kind: "model", agent: "main" } },
    ...(extra.requestId === undefined ? {} : { requestId: extra.requestId }),
    ...(extra.signal === undefined ? {} : { signal: extra.signal }),
  };
}

/** 진행 중인 비동기 호출이 다음 대기점에 이를 때까지 기다린다(실제 승인 서비스는 요청 하나에 대기점이 여럿이다). 가짜 타이머와 무관한 실제 한 틱이다 */
export async function flushTicks(): Promise<void> {
  await Bun.sleep(0);
}

export interface AskHarness {
  readonly deps: AskDeps;
  /** `harness({ approvals })`로 실제 승인 서비스를 붙였을 때만 있다 */
  readonly approvals: RealApprovals | undefined;
  readonly timers: ManualTimers;
  readonly lines: LogLine[];
}

/** 실제 승인 서비스를 붙인 조립 */
export interface ApprovingAskHarness extends AskHarness {
  readonly approvals: RealApprovals;
}

export interface AskHarnessOptions {
  readonly approvals?: RealApprovals | null;
  readonly interactive?: AskDeps["interactive"];
}

/** 대역으로 질문 서비스 의존을 만든다. 승인은 `realApprovals()`를 넘길 때만 붙는다(생략하거나 null이면 없다) */
export function harness(
  options: AskHarnessOptions & { readonly approvals: RealApprovals },
): ApprovingAskHarness;
export function harness(options?: AskHarnessOptions): AskHarness;
export function harness(options: AskHarnessOptions = {}): AskHarness {
  const approvals = options.approvals ?? undefined;
  const timers = manualTimers();
  const lines: LogLine[] = [];
  const deps: AskDeps = {
    logger: recordingLogger(lines),
    timers,
    settings: () => ({ ask: { timeoutSec: 0 } }),
    approvals: approvals?.factory,
    interactive: options.interactive ?? (() => true),
  };
  return { deps, approvals, timers, lines };
}
