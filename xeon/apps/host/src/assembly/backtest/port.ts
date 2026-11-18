import { parse } from "@fresnel/contracts";
import { ThreadIdSchema } from "@fresnel/contracts/conversation";
import type { SessionService } from "@fresnel/contracts/records";
import type { TurnRecordReadPort } from "../measure/turn-read.ts";
import { createCandidateResolver, readManifestFile, type CandidateStoreView } from "./candidate.ts";
import type { BacktestIsolation } from "./isolation.ts";
import { createItemLogReader } from "./item-log.ts";
import { createBacktestService, type BacktestPort } from "./service.ts";
import type { BacktestSettingsValues } from "./scope.ts";

// 돌려 보기 포트의 조립(turn-record-metrics.md §3.5). 조립 루트(`ports.ts`)가 원천을 넘기면 서비스를 만든다.
// 격리와 설정은 늦게 묶는 함수로 받는다(플러그인 호스트 조립이 조립 루트보다 뒤에 만들어지므로).

/** 조립 루트가 넘기는 원천 */
export interface BacktestAssemblyDeps {
  readonly turns: Pick<TurnRecordReadPort, "list" | "get">;
  readonly session: Pick<SessionService, "readFrom" | "hydrate" | "query">;
  readonly plugins: CandidateStoreView;
  /** 알고 있는 대화 id 목록 */
  readonly threadIds: () => readonly string[];
  readonly isolation: () => BacktestIsolation;
  readonly settings: () => BacktestSettingsValues;
  readonly now: () => number;
  readonly newRunId: () => string;
}

/** 격리와 설정의 늦은 원천. 플러그인 호스트 조립이 조립 루트보다 뒤에 만들어지므로 함수로 받는다 */
export interface BacktestSource {
  readonly isolation: () => BacktestIsolation;
  readonly settings: () => BacktestSettingsValues;
}

/** 돌려 보기 포트를 만든다 */
export function createBacktestPort(deps: BacktestAssemblyDeps): BacktestPort {
  return createBacktestService({
    scope: { turns: deps.turns, threadIds: deps.threadIds },
    threadExists: (threadId) => {
      const id = parse(ThreadIdSchema, threadId);
      if (!id.ok) return false;
      const row = deps.session.query.thread(id.value);
      // 조회 자체가 실패하면 있는 것으로 보고 로그 읽기에 맡긴다. 로그 읽기 실패는 실행 실패로 드러난다
      return !row.ok || row.value !== undefined;
    },
    readItemEvents: createItemLogReader(deps.session),
    resolveCandidate: createCandidateResolver({
      store: deps.plugins,
      readManifestText: readManifestFile,
    }),
    isolation: deps.isolation,
    settings: deps.settings,
    now: deps.now,
    newRunId: deps.newRunId,
  });
}
