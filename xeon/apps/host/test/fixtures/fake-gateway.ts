import { err, ok, type Result } from "@fresnel/contracts";
import type {
  GatewayConfig,
  GatewaySupervisor,
  RemoteDevice,
  RemoteFailure,
  RemoteStatusView,
} from "../../src/service/gateway.ts";

// 시험용 게이트웨이 감독자. 자식 프로세스를 띄우지 않는다. 호출을 세고 start가 받은 설정을 기록한다.
// 상태는 실제 감독자처럼 바뀐다: start하면 running, stop하면 off. 꺼진 상태의 pair·devices·revoke는 remote-off다.

/** 페어링 코드 만료 시각(epoch ms). 시계를 1800000000000으로 둔 시험이 "5분 뒤"로 읽는다 */
export const FAKE_PAIR_CODE = "ABCDE12345";
export const FAKE_PAIR_EXPIRES_AT = 1_800_000_300_000;

export const OFF_VIEW: RemoteStatusView = {
  enabled: false,
  state: "off",
  loopbackPort: null,
  tlsPort: null,
  hosts: [],
  fingerprint: null,
  certSource: null,
  pushAvailable: false,
  error: null,
};

export const RUNNING_VIEW: RemoteStatusView = {
  enabled: true,
  state: "running",
  loopbackPort: 8480,
  tlsPort: null,
  hosts: [],
  fingerprint: "a".repeat(64),
  certSource: null,
  pushAvailable: true,
  error: null,
};

const DEVICE: RemoteDevice = {
  id: "dev_0123456789abcdef",
  name: "laptop",
  kind: "web",
  createdAt: 1_700_000_000_000,
  lastSeenAt: null,
  address: null,
};

const REMOTE_OFF: RemoteFailure = { kind: "remote-off" };

export interface FakeGateway {
  readonly supervisor: GatewaySupervisor;
  /** start가 받은 설정들의 기록 */
  readonly starts: GatewayConfig[];
  readonly counts: { stops: number; disposes: number; pairs: number };
}

export function fakeGateway(initial: RemoteStatusView = OFF_VIEW): FakeGateway {
  const state: { view: RemoteStatusView } = { view: initial };
  const starts: GatewayConfig[] = [];
  const counts = { stops: 0, disposes: 0, pairs: 0 };
  const whenRunning = <T>(work: () => T): Promise<Result<T, RemoteFailure>> =>
    Promise.resolve(state.view.state === "running" ? ok(work()) : err(REMOTE_OFF));
  const supervisor: GatewaySupervisor = {
    status: () => state.view,
    start(config) {
      starts.push(config);
      state.view = RUNNING_VIEW;
      return Promise.resolve(state.view);
    },
    stop() {
      counts.stops += 1;
      state.view = OFF_VIEW;
      return Promise.resolve(state.view);
    },
    pair() {
      counts.pairs += 1;
      return whenRunning(() => ({ code: FAKE_PAIR_CODE, expiresAt: FAKE_PAIR_EXPIRES_AT }));
    },
    devices() {
      return whenRunning(() => [DEVICE]);
    },
    revoke() {
      return whenRunning(() => ({ revoked: 1 }));
    },
    dispose() {
      counts.disposes += 1;
      return Promise.resolve();
    },
  };
  return { supervisor, starts, counts };
}
