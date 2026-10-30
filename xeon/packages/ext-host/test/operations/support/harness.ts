import {
  ProjectorRegistryPortKey,
  RecordCommitPortKey,
  ScopedStorePortKey,
  type ExtensionName,
  type RecordCommitPort,
} from "@xeon/contracts/extensions";
import {
  createOperationsPolicy,
  createScopeControl,
  createStaticOperationsSettings,
  type OperationsNotifier,
  type ReservedNames,
  type OperationsPolicy,
  type ScopeControl,
  type StaticOperationsSettings,
} from "../../../src/operations/index.ts";
import {
  scopeToggleSourceOf,
  type ExtHost,
  type PortKey,
  type PortLookup,
} from "../../../src/primitives/index.ts";
import {
  createTestHost,
  fakeTimers,
  memoryRecordStore,
  type MemoryRecordStore,
  type TestHost,
  type TestHostOptions,
} from "../../../src/testing/index.ts";
import { createFakeSession, type FakeSession } from "./fake-session.ts";

export interface OperationsHarness {
  readonly t: TestHost;
  readonly policy: OperationsPolicy;
  /** 정책이 ScopeControl로 보낸 요청 */
  readonly requests: string[];
  readonly notices: string[];
}

export interface HarnessOptions {
  readonly settings?: StaticOperationsSettings;
  readonly host?: Omit<TestHostOptions, "timers" | "policy" | "setupBudget">;
  readonly guardStatements?: boolean;
  readonly reservedNames?: ReservedNames;
}

/** 정책이 ExtHost보다 먼저 만들어지므로 ScopeControl·포트를 늦게 연결한다(조립 순서, X.operations.spec §3.8) */
export async function createOperationsHarness(
  options: HarnessOptions = {},
): Promise<OperationsHarness> {
  const timers = fakeTimers();
  const late: { host?: ExtHost; scopes?: ScopeControl } = {};
  const requests: string[] = [];
  const notices: string[] = [];
  const scopes: ScopeControl = {
    requestDisable: (scopeId, reason) => {
      requests.push(`disable:${scopeId}:${reason}`);
      late.scopes?.requestDisable(scopeId, reason);
    },
    requestEnable: (scopeId, reason) => {
      requests.push(`enable:${scopeId}:${reason}`);
      late.scopes?.requestEnable(scopeId, reason);
    },
    scopesOf: (extension: ExtensionName) => late.scopes?.scopesOf(extension) ?? [],
  };
  const ports: PortLookup = {
    get<Api>(key: PortKey<Api>): Api | undefined {
      return late.host?.ports.get(key);
    },
  };
  const notifier: OperationsNotifier = {
    handlerFailed: (outcome, stats) => {
      notices.push(`failed:${outcome.result}:${stats.consecutive}`);
    },
    autoDisabled: (key, verdict) => {
      notices.push(`auto-disabled:${key}:${verdict.rule}`);
    },
    projectionFailed: (key, cause, disabled) => {
      notices.push(`projection-failed:${key}:${cause}:${disabled}`);
    },
  };
  const policy = createOperationsPolicy({
    now: timers.now,
    setTimer: timers.setTimer,
    settings: createStaticOperationsSettings(options.settings),
    scopes,
    notifier,
    ports,
    ...(options.guardStatements === undefined ? {} : { guardStatements: options.guardStatements }),
    ...(options.reservedNames === undefined ? {} : { reservedNames: options.reservedNames }),
  });
  const t = await createTestHost({
    ...options.host,
    timers,
    policy,
    resourcePolicy: policy.resources,
    setupBudget: () => policy.setupBudgetMs(),
  });
  late.host = t.host;
  late.scopes = createScopeControl(scopeToggleSourceOf(t.host));
  return { t, policy, requests, notices };
}

// ── 저장 영역까지 연결한 하네스 ───────────────────────────────────────────

/**
 * RecordCommitPort 앞에 세션 투영을 붙인다: 커밋된 초안을 이벤트 봉투로 바꿔 투영기를 같은 순간에 실행한다.
 * 실제 SessionWriter는 한 트랜잭션이지만 이 대역은 기록 → 투영 순서다(투영이 실패하면 기록은 남는다)
 */
function linkedRecordPort(records: MemoryRecordStore, session: FakeSession): RecordCommitPort {
  return {
    commit: async (request) => {
      const result = await records.commit(request);
      if (result.status === "committed") {
        session.commit(
          request.drafts.map((draft) => ({
            ...draft,
            recordedAt: 1_767_571_200_000,
            seq: 0,
            parentId: null,
          })),
        );
      }
      return result;
    },
    loadThread: (threadId) => records.loadThread(threadId),
    queryRecords: (threadId, query, reader) => records.queryRecords(threadId, query, reader),
  };
}

export interface StorageHarness extends OperationsHarness {
  readonly session: FakeSession;
  readonly records: MemoryRecordStore;
  /** 세션 투영까지 연결된 기록 포트. L1이 커밋하는 모습을 흉내 낼 때 쓴다 */
  readonly port: RecordCommitPort;
}

export async function createStorageHarness(
  options: HarnessOptions & {
    readonly session?: FakeSession;
    readonly records?: MemoryRecordStore;
    readonly withoutSession?: boolean;
  } = {},
): Promise<StorageHarness> {
  const session = options.session ?? createFakeSession();
  const records = options.records ?? memoryRecordStore();
  const harness = await createOperationsHarness({
    ...options,
    guardStatements: options.guardStatements ?? true,
    host: { ...options.host, without: ["records"], shared: { records } },
  });
  const port = linkedRecordPort(records, session);
  if (options.withoutSession !== true) {
    await harness.t.host.registerPlatform({
      name: "test-session",
      setup(ctx) {
        ctx.providePort(RecordCommitPortKey, port);
        ctx.providePort(ProjectorRegistryPortKey, session.registry);
        ctx.providePort(ScopedStorePortKey, session.store);
      },
    });
  }
  return { ...harness, session, records, port };
}
