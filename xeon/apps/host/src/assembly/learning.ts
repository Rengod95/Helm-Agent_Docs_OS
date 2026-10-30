import { KnowledgeLedger, KnowledgeLedgerKey } from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionEntry } from "@xeon/contracts/extensions";
import { createKnowledgeProposalWire, type KnowledgeProposalWire } from "@xeon/cap-knowledge";
import type { CommandResourceDef, ExtensionUnit, ResourceRegistry } from "@xeon/ext-host";
import {
  createLearningBridge,
  createLearningGroup,
  createSqlReader,
  createLearningProjector,
  learningProjector,
  type CommandReport,
  type LearningBridge,
  type LearningQueueReader,
  type StoreFailure,
} from "@xeon/group-learning";
import { err, type Clock, type Logger } from "@xeon/contracts";
import type { SessionService, StoreService } from "@xeon/contracts/records";
import { isId, type IdFactory, type ThreadId } from "@xeon/contracts/conversation";

// 학습 그룹을 내장 그룹으로 싣는다(D-M3-02: 기본 켬). 조립 루트가 하는 일은 넷이다: 대기열 읽기 면과 목록 면(브리지)을 만들어 그룹에 넘기고,
// 투영기(`learningProjector`)를 세션 서비스에 등록하고(`registerLearningProjection`), 결정과 지연 정리를 `/learning` 명령으로 실행하고(`createLearningRunner`),
// L2.knowledge 제안 대기열 어댑터를 얻는 브리지 확장을 올린다. cap-knowledge가 `learning.queue` 승인 증거를 믿게 하는 일은 extensions.ts에 있다(M3-REQ-104).
// 대기열 행은 이벤트 투영이라 호스트가 행을 직접 쓰지 않는다. 결정과 정리는 기록을 쓰므로 대화(ambient)가 필요하고, 그래서 명령 처리기를 거친다.
// 조립 루트 코드(DR-14 예외 2).

/** 학습 그룹을 싣는가. 기본 그룹을 끄거나(`defaultGroups: false`) 안전 모드면 싣지 않는다 [결정: review.m3-design-inputs D-M3-07 a] */
export function learningLoaded(options: {
  readonly defaultGroups: boolean | undefined;
  readonly safeMode: boolean | undefined;
}): boolean {
  return options.defaultGroups !== false && options.safeMode !== true;
}

/** `xeon.knowledge`의 제안 대기열 어댑터를 나중에 채우는 자리. 브리지 확장이 채우고 `proposal.*` 처리기가 부를 때 읽는다 */
export interface KnowledgeWireHolder {
  current: KnowledgeProposalWire | undefined;
}

/** 읽기 면을 나중에 채우는 자리. 세션 서비스가 올라오기 전(또는 학습 그룹을 싣지 않은 구성)에는 읽기가 `storeUnavailable` 값이다 */
export interface ReaderSlot {
  current: LearningQueueReader | undefined;
}

function notReady(): StoreFailure {
  return { kind: "learning.storeUnavailable", detail: "the learning projection is not ready" };
}

/** `slot`에 채워진 읽기 구현으로 넘기는 읽기 면. 비어 있으면 모든 읽기가 오류 값이다 */
export function slotReader(slot: ReaderSlot): LearningQueueReader {
  return {
    getProposal: async (id) => slot.current?.getProposal(id) ?? err(notReady()),
    listProposals: async (filter) => slot.current?.listProposals(filter) ?? err(notReady()),
    getReviewByChild: async (child) => slot.current?.getReviewByChild(child) ?? err(notReady()),
    getReview: async (threadId, requestId) =>
      slot.current?.getReview(threadId, requestId) ?? err(notReady()),
    listReviews: async (filter) => slot.current?.listReviews(filter) ?? err(notReady()),
  };
}

/** `/learning` 명령 한 줄의 실행 결과. 실행할 대화가 없거나 명령이 등록돼 있지 않으면 `unavailable`이다 */
type LearningRun =
  | { readonly kind: "report"; readonly report: CommandReport }
  | { readonly kind: "unavailable"; readonly detail: string };

export interface LearningRunner {
  /**
   * 명령 줄을 실행한다. `preferred` 대화가 이 호스트에서 열려 있으면 거기서, 아니면 가장 최근에 연 대화에서 실행한다.
   * 열린 대화가 없으면 `unavailable`이다(결정 기록을 쓸 대화가 없다). `signal`은 부른 쪽의 취소 신호로, 처리기의 `ctx.signal`에 그대로 넘긴다
   */
  run(line: string, preferred: string | undefined, signal: AbortSignal): Promise<LearningRun>;
  /** 그룹이 명령 결과를 내는 자리(`LearningDeps.report`) */
  report(report: CommandReport, invocationId: string): void;
}

export interface LearningRunnerDeps {
  readonly resources: () => ResourceRegistry | undefined;
  readonly ids: IdFactory;
  readonly heldThreads: () => readonly ThreadId[];
  readonly activeThread: () => ThreadId | null;
}

function isCommandDef(def: unknown): def is CommandResourceDef {
  return (
    typeof def === "object" && def !== null && "handler" in def && typeof def.handler === "function"
  );
}

export function createLearningRunner(deps: LearningRunnerDeps): LearningRunner {
  const reports = new Map<string, CommandReport>();
  return {
    report(report, invocationId) {
      reports.set(invocationId, report);
    },
    async run(line, preferred, signal) {
      const record = deps
        .resources()
        ?.list("command")
        .find((entry) => entry.extension === "learning" && entry.name === "learning");
      if (record === undefined || !isCommandDef(record.def)) {
        return { kind: "unavailable", detail: "the learning command is not registered" };
      }
      const held = deps.heldThreads();
      const threadId =
        preferred !== undefined && isId("thr", preferred) && held.includes(preferred)
          ? preferred
          : deps.activeThread();
      if (threadId === null) {
        return { kind: "unavailable", detail: "no conversation is open to record the decision" };
      }
      // 호출 id는 호출마다 새로 만든다. 같은 호출을 다시 실행해야 하는 호출자(재시도)는 같은 값을 넘겨야 하고, 이 경로는 재시도하지 않는다
      const invocationId = deps.ids.next("evt");
      let report: CommandReport | undefined;
      try {
        await record.def.handler(line, { threadId, invocationId, signal });
      } finally {
        // 처리기가 던져도 결과 자리를 남기지 않는다
        report = reports.get(invocationId);
        reports.delete(invocationId);
      }
      return report === undefined
        ? { kind: "unavailable", detail: "the learning command returned no result" }
        : { kind: "report", report };
    },
  };
}

export interface LearningWiring {
  readonly bridge: LearningBridge;
  readonly reader: ReaderSlot;
  readonly runner: LearningRunner;
  readonly knowledge: KnowledgeWireHolder;
}

export function createLearningWiring(deps: LearningRunnerDeps): LearningWiring {
  return {
    bridge: createLearningBridge(),
    reader: { current: undefined },
    runner: createLearningRunner(deps),
    knowledge: { current: undefined },
  };
}

const BRIDGE_NAME = "host-proposals-bridge";

/**
 * `knowledge.ledger` 능력으로 L2.knowledge 제안 대기열 어댑터를 만들어 `holder`에 채우는 조립 확장. `proposal.list`·`proposal.decide`가
 * 호스트(사용자) 호출 문맥으로 부른다. 안전 모드에서도 L2는 싣기 때문에 이 확장도 싣는다
 */
export function proposalsBridgePlugin(
  holder: KnowledgeWireHolder,
  loadIndex: number,
): ExtensionUnit {
  const manifest = defineManifest({
    schemaVersion: 1,
    name: BRIDGE_NAME,
    version: "0.1.0",
    displayName: "Proposals bridge",
    description:
      "Hands the knowledge proposal queue adapter to the proposal.list and proposal.decide handlers (host assembly).",
    defaultEnabled: true,
    layer: "L2",
    kind: "plugin",
    entry: "./src/index.ts",
    requires: [{ id: KnowledgeLedger.id, range: `^${KnowledgeLedger.version}` }],
    points: [],
    usesDrive: false,
    trust: { level: "builtin" },
  });
  const entry: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, { defaultEnabled: true }, (g) => {
      holder.current = createKnowledgeProposalWire(g.capability(KnowledgeLedgerKey));
      g.onDispose(() => {
        holder.current = undefined;
      });
    });
  };
  return { manifest, entry, loadIndex, builtin: true };
}

export interface LearningUnitDeps {
  readonly wiring: LearningWiring;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** 학습 그룹 확장 단위. 후보 id는 도구 호출 id에서 정해진다(L3.learning.spec §3.6) */
export function learningUnit(deps: LearningUnitDeps, loadIndex: number): ExtensionUnit {
  const module = createLearningGroup({
    clock: deps.clock,
    reader: slotReader(deps.wiring.reader),
    bridge: deps.wiring.bridge,
    // `/learning` 명령의 처리기는 값을 돌려주지 않는다(F 계약은 `void`나 `CommandOutput`을 허용한다). 결정 경로는 호출 id로 자기 결과를 찾고, 그 밖은 기록만 한다
    report: (report, invocationId) => {
      deps.wiring.runner.report(report, invocationId);
      deps.logger.info("learning.command", { kind: report.kind });
    },
  });
  return { manifest: module.manifest, entry: module.entry, loadIndex, builtin: true };
}

export interface LearningProjectionDeps {
  readonly session: SessionService;
  readonly store: StoreService;
  readonly wiring: LearningWiring;
  /** 해독하지 못해 건너뛴 학습 기록의 kind를 받는다 */
  readonly onSkipped: (kind: string) => void;
}

/**
 * 투영기를 세션 서비스에 등록하고 읽기 면을 채운다. 등록 때 투영기 버전이 저장된 것과 다르면 그 투영기만 기록에서 다시 만든다
 * (F.records.spec §3.9). 실패하면 사람이 읽을 이유를, 성공하면 undefined를 돌려준다
 */
export function registerLearningProjection(deps: LearningProjectionDeps): string | undefined {
  const owner = deps.store.extensions.register("learning");
  if (!owner.ok) return `learning tables were not registered: ${owner.error.kind}`;
  const registered = deps.session.projectors.register(createLearningProjector(deps.onSkipped));
  if (!registered.ok) return `the learning projector was not registered: ${registered.error.kind}`;
  deps.wiring.reader.current = createSqlReader(deps.store.scoped(learningProjector.name));
  return undefined;
}
