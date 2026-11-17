// 격리 알림의 흐름 제어(drive-isolation.md 3.2 이벤트 전달, F.extensions 부록 `event.notify`·`event.done`).
// 엔진은 스트림 알림을 흐름 키(등록, 지점, handlerIndex, 대화)마다 센다. 자식의 확인(`event.done`)이 오기 전에 보낸 수가
// 상한에 닿으면 다음 알림은 대기 칸 하나에 덮어쓰고 덮인 수를 센다. 확인이 오면 대기 칸을 `dropped`와 함께 보낸다.
// 보내기는 기다리지 않고 던지지 않는다(턴을 붙잡지 않는다). 실패는 진단이다.
import { attempt, detach, type Logger } from "@fresnel/contracts";
import type { JsonObject } from "@fresnel/contracts/conversation";

/** 확인을 받지 못한 알림의 상한(흐름 키마다). 상한에 닿으면 다음 알림은 대기 칸 하나에 합친다 [제안] */
export const NOTIFY_INFLIGHT_MAX = 8;

/**
 * 상한에 닿은 채 이 시간(ms)이 지나도 풀리지 않으면 미확인 수를 0으로 되돌리고 진단을 남긴다. 확인을 보내지 않는 낡은
 * 자식이 흐름을 영원히 막지 않게 한다 [제안]
 */
export const NOTIFY_STALL_MS = 30_000;

/** 알림이 속한 흐름 하나. `key`는 `notifyKeyOf`가 만들고, `point`는 진단에 쓴다 */
interface NotifyRoute {
  readonly key: string;
  readonly point: string;
}

/** 흐름 키. 같은 등록의 같은 지점, 같은 핸들러가 같은 대화에서 받는 알림끼리 센다 */
export function notifyKeyOf(
  registration: string,
  point: string,
  handlerIndex: number,
  threadId: string | null,
): string {
  return JSON.stringify([registration, point, handlerIndex, threadId]);
}

export interface NotifyGateDeps {
  /** 알림 하나를 자식에 쓴다. 쓰지 못했으면 `false`다. 감독의 `notify`가 쓴다 */
  readonly send: (params: JsonObject) => Promise<boolean>;
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  readonly now: () => number;
  readonly logger: Logger;
}

export interface NotifyGate {
  /** 알림 하나를 보내거나 대기 칸에 합친다. 기다리지 않고 던지지 않는다 */
  offer(route: NotifyRoute, eventKey: string, body: JsonObject): void;
  /** 자식이 `event.done`으로 이 알림의 처리를 확인했다. 확인되지 않은 `eventKey`는 무시한다 */
  acknowledge(eventKey: string): void;
  /** 프로세스가 끝났거나 세션이 닫혔다: 미확인 수, 대기 칸, 정체 시계를 모두 버린다 */
  reset(): void;
}

/** 대기 칸 하나. 덮어쓴 최신 알림과, 그 앞에서 덮인 수 */
interface Slot {
  readonly eventKey: string;
  readonly body: JsonObject;
  readonly dropped: number;
}

/** 흐름 키 하나의 상태 */
interface Route {
  readonly point: string;
  /** 보냈으나 확인을 받지 못한 알림의 `eventKey` */
  readonly inflight: Set<string>;
  slot: Slot | undefined;
  /** 상한에 닿은 시각(`deps.now`). 닿아 있지 않으면 undefined */
  saturatedAt: number | undefined;
  cancelStall: (() => void) | undefined;
}

export function createNotifyGate(deps: NotifyGateDeps): NotifyGate {
  const routes = new Map<string, Route>();
  /** `eventKey`에서 흐름 키로. 확인이 어느 흐름의 것인지 찾는다 */
  const owners = new Map<string, string>();

  function routeOf(route: NotifyRoute): Route {
    const found = routes.get(route.key);
    if (found !== undefined) return found;
    const created: Route = {
      point: route.point,
      inflight: new Set<string>(),
      slot: undefined,
      saturatedAt: undefined,
      cancelStall: undefined,
    };
    routes.set(route.key, created);
    return created;
  }

  function disarm(state: Route): void {
    state.cancelStall?.();
    state.cancelStall = undefined;
    state.saturatedAt = undefined;
  }

  /** 흐름 상태가 바뀐 뒤 정체 시계를 맞춘다. 상한에 닿았으면 재고, 풀렸으면 끈다. 아무것도 없으면 흐름을 버린다 */
  function settle(key: string, state: Route): void {
    if (state.inflight.size >= NOTIFY_INFLIGHT_MAX) {
      if (state.cancelStall === undefined) {
        state.saturatedAt = deps.now();
        state.cancelStall = deps.setTimer(NOTIFY_STALL_MS, () => checkStall(key));
      }
      return;
    }
    disarm(state);
    if (state.slot === undefined && state.inflight.size === 0) routes.delete(key);
  }

  /** 정체 시계가 울렸다. 상한에 닿은 채 `NOTIFY_STALL_MS`가 지났으면 미확인 수를 0으로 되돌린다 */
  function checkStall(key: string): void {
    const state = routes.get(key);
    if (state === undefined) return;
    state.cancelStall = undefined;
    if (state.inflight.size < NOTIFY_INFLIGHT_MAX || state.saturatedAt === undefined) return;
    const waited = deps.now() - state.saturatedAt;
    if (waited < NOTIFY_STALL_MS) {
      state.cancelStall = deps.setTimer(NOTIFY_STALL_MS - waited, () => checkStall(key));
      return;
    }
    deps.logger.warn("plugin_host.notify_stalled", {
      point: state.point,
      unacked: state.inflight.size,
      waitedMs: waited,
    });
    for (const eventKey of state.inflight) owners.delete(eventKey);
    state.inflight.clear();
    disarm(state);
    flush(key, state);
    settle(key, state);
  }

  /** 대기 칸이 있고 상한 안에 자리가 나면 그 알림을 보낸다 */
  function flush(key: string, state: Route): void {
    const next = state.slot;
    if (next === undefined || state.inflight.size >= NOTIFY_INFLIGHT_MAX) return;
    state.slot = undefined;
    transmit(key, state, next);
  }

  /** 알림 하나를 자식에 쓴다. 기다리지 않는다. 쓰지 못하거나 거부되면 확인 없이 흐름에서 뺀다 */
  function transmit(key: string, state: Route, item: Slot): void {
    state.inflight.add(item.eventKey);
    owners.set(item.eventKey, key);
    const params: JsonObject =
      item.dropped === 0
        ? { ...item.body, eventKey: item.eventKey }
        : { ...item.body, eventKey: item.eventKey, dropped: item.dropped };
    const sent = attempt(() => deps.send(params));
    if (!sent.ok) {
      deps.logger.warn("plugin_host.notify_failed", { point: state.point });
      release(item.eventKey);
      return;
    }
    detach(
      sent.value.then((delivered) => {
        if (!delivered) {
          deps.logger.warn("plugin_host.notify_failed", { point: state.point });
          release(item.eventKey);
        }
        return delivered;
      }),
      () => {
        deps.logger.error("plugin_host.notify_unhandled", { point: state.point });
        release(item.eventKey);
      },
    );
  }

  /** 확인이든 실패든 이 알림은 미확인에서 빠진다. 자리가 나면 대기 칸을 보낸다 */
  function release(eventKey: string): void {
    const key = owners.get(eventKey);
    if (key === undefined) return;
    owners.delete(eventKey);
    const state = routes.get(key);
    if (state === undefined) return;
    state.inflight.delete(eventKey);
    flush(key, state);
    settle(key, state);
  }

  return {
    offer(route, eventKey, body) {
      const state = routeOf(route);
      if (state.inflight.size < NOTIFY_INFLIGHT_MAX) {
        transmit(route.key, state, { eventKey, body, dropped: 0 });
      } else {
        // 대기 칸 하나에 덮어쓴다. 칸이 이미 차 있었으면 그 알림과 그 앞의 덮인 수까지 덮인 것이다
        state.slot = {
          eventKey,
          body,
          dropped: state.slot === undefined ? 0 : state.slot.dropped + 1,
        };
      }
      settle(route.key, state);
    },
    acknowledge(eventKey) {
      release(eventKey);
    },
    reset() {
      for (const state of routes.values()) disarm(state);
      routes.clear();
      owners.clear();
    },
  };
}
