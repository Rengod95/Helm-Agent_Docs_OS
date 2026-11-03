import type { EffectiveSetting, SettingDefWire } from "@fresnel/contracts/settings";
import type {
  HostConnection,
  ServerNotificationName,
  ServerNotificationParams,
  WireMethodName,
  WireParams,
  WireResult,
} from "@fresnel/contracts/wire";

// 설정 view-model 시험의 입력 도우미. 정의는 와이어 형태(SettingDefWire)로 직접 쓴다.

const SCOPES_ALL: SettingDefWire["allowedScopes"] = [
  "managed",
  "user",
  "project",
  "local",
  "launch",
];

/** 기본값이 채워진 와이어 정의. 시험마다 필요한 필드만 바꾼다 */
export function wireDef(
  input: Pick<SettingDefWire, "key" | "type"> & Partial<SettingDefWire>,
): SettingDefWire {
  return {
    runtimeChange: "live",
    layer: "L1",
    allowedScopes: SCOPES_ALL,
    since: "0.1.0",
    ...input,
  };
}

/** 유효 값 하나. 기본 출처는 사용자 파일이다 */
export function effectiveOf(
  key: string,
  value: unknown,
  extra: Partial<EffectiveSetting> = {},
): EffectiveSetting {
  return {
    key,
    value,
    source: { scope: "user", path: "/home/user/.fresnel/settings.json" },
    locked: false,
    shadowed: [],
    runtimeChange: "live",
    pendingUntil: null,
    deprecated: false,
    ...extra,
  };
}

// ── 가짜 연결(설정 컨트롤러 시험) ──────────────────────────────────────────
// 메서드마다 응답 함수를 넣는다. 응답하지 않은 메서드는 거부한다. 보낸 요청은 `calls`에 쌓인다.

type Handler<M extends WireMethodName> = (params: WireParams<M>) => Promise<WireResult<M>>;
export type ConnectionTable = { [M in WireMethodName]?: Handler<M> };
type NoticeHandlers = {
  [N in ServerNotificationName]: Set<(params: ServerNotificationParams<N>) => void>;
};

export interface FakeConnection {
  readonly connection: HostConnection;
  emit<N extends ServerNotificationName>(name: N, params: ServerNotificationParams<N>): void;
  readonly calls: readonly { readonly method: string; readonly params: unknown }[];
}

export function fakeConnection(table: ConnectionTable): FakeConnection {
  const handlers: NoticeHandlers = {
    "events.batch": new Set(),
    "events.ended": new Set(),
    "stream.chunk": new Set(),
    "settings.invalidated": new Set(),
    "notify.delivered": new Set(),
    "profile.changed": new Set(),
  };
  const calls: { method: string; params: unknown }[] = [];
  const connection: HostConnection = {
    request: (method, params) => {
      calls.push({ method, params });
      const handler = table[method];
      if (handler === undefined) return Promise.reject(new Error(`unhandled ${method}`));
      return handler(params);
    },
    onNotification: (name, handler) => {
      handlers[name].add(handler);
      return () => void handlers[name].delete(handler);
    },
    notify: () => Promise.resolve(),
    close: () => Promise.resolve(),
    closed: new Promise(() => {}),
  };
  return {
    connection,
    emit: (name, params) => {
      for (const handler of handlers[name]) handler(params);
    },
    calls,
  };
}
