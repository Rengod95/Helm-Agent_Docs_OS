import { Bug, parse, type Logger } from "@fresnel/contracts";
import { ExtensionNameSchema, type IsolationProcessPort } from "@fresnel/contracts/extensions";
import {
  createCandidateRunner,
  type CandidateRunner,
  type IsolationLaunch,
  type IsolationLaunchInfo,
} from "@fresnel/ext-host";

// 돌려 보기의 격리 조립(turn-record-metrics.md §4.8 규칙 46). 후보는 플러그인 호스트 자식에서만 돈다. 이 파일이 실행기를 만드는 유일한 곳이다.
// 띄우기 포트와 띄울 명령은 플러그인 호스트 조립(`assembly/plugin-host.ts`)이 준 것을 그대로 쓴다. 포트가 없거나 격리가 꺼졌으면 돌려 보기도 꺼진다.

/** 돌려 보기가 쓸 수 있는지와 실행기 만들기. 쓸 수 없으면 실행기를 만들지 않는다 */
export type BacktestIsolation =
  | { readonly available: false }
  | { readonly available: true; readonly createRunner: () => CandidateRunner };

/** host.init 응답 시한의 기본값(ms). 플러그인 호스트 조립의 값과 같다(`PLUGIN_HOST_INIT_TIMEOUT_MS`) */
const CANDIDATE_INIT_TIMEOUT_MS = 5000;

export interface BacktestIsolationDeps {
  /** 격리가 켜져 있나(`x.loading-trust`의 시험 끄기 설정이 아닌가). 끄면 돌려 보기도 꺼진다 */
  readonly enabled: boolean;
  /** 띄우기 포트(추적 포트). 플랫폼 프로세스가 없으면 undefined다 */
  readonly process: IsolationProcessPort | undefined;
  /** 띄울 명령. 플러그인 호스트 조립의 `isolation.launch`를 그대로 쓴다 */
  readonly launch: (info: IsolationLaunchInfo) => IsolationLaunch;
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  /** host.init 시한. 없으면 기본값이다 */
  readonly initTimeoutMs: number | undefined;
  readonly now: () => number;
  readonly logger: Logger;
  readonly maskSecrets: (line: string) => string;
}

/** 돌려 보기 격리를 만든다. 띄우기 포트가 없거나 꺼졌으면 `available: false`다 */
export function createBacktestIsolation(deps: BacktestIsolationDeps): BacktestIsolation {
  const port = deps.process;
  if (!deps.enabled || port === undefined) return { available: false };
  return {
    available: true,
    createRunner: () =>
      createCandidateRunner({
        process: port,
        launch: (info) => {
          // 확장 이름은 후보를 찾을 때 이미 검사했다. 여기서 다시 깨지면 호출 계약 위반이다
          const name = parse(ExtensionNameSchema, info.name);
          // fresnel-disable-next-line fresnel/bug-for-expected -- 이름은 후보를 찾을 때 확장 이름 검사를 거친 값이다. 여기서 어긋나면 호출 계약 위반이다 (eng.typescript.guide TY-24)
          if (!name.ok) throw new Bug(`backtest.launch_name: ${info.name}`);
          return deps.launch({
            name: name.value,
            root: info.root,
            entry: info.entry,
            versionId: info.versionId,
          });
        },
        setTimer: deps.setTimer,
        now: deps.now,
        logger: deps.logger,
        initTimeoutMs: deps.initTimeoutMs ?? CANDIDATE_INIT_TIMEOUT_MS,
        maskSecrets: deps.maskSecrets,
      }),
  };
}
