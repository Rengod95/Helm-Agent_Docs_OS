import { err, ok, type Result } from "@xeon/contracts";
import type { JsonValue } from "@xeon/contracts/conversation";
import {
  RECORD_KIND_PATTERN,
  RECORD_KIND_READ_PATTERN,
  type ExtensionName,
  type ScopeApi,
  type ScopeId,
  type Unsubscribe,
} from "@xeon/contracts/extensions";
import { withoutAmbient } from "./ambient.ts";
import type { Generation, HostCore } from "./core.ts";
import { deepFreeze } from "./freeze.ts";
import { scopeInternalsOf } from "./host-api.ts";
import { isKindReadable, ownKindPrefix } from "./read-scope.ts";

/**
 * 호스트 안쪽 휘발 이벤트 버스(X.primitives.spec §4.9, P-26). 확장 코드에는 주지 않는다.
 * 확장 사이의 통신은 그룹 레코드와 능력 서비스로 하는 것이 원칙이고(F.extensions.spec §4.8), 이 버스는 호스트 안쪽
 * 코드가 휘발 신호를 주고받을 때만 쓴다. 규칙은 두 가지다.
 * - 발행 이름은 자기 접두(`grp.<이름>.`, 플러그인은 `x.<이름>.`)여야 한다
 * - 구독 이름은 자기 접두이거나 매니페스트 `readsRecordKinds`가 덮어야 한다(기록 읽기와 같은 검사)
 * 이벤트는 저장하지 않는다. 구독자는 발행이 돌아온 뒤 마이크로태스크에서 호출되고, 재시작 뒤에는 남지 않는다
 */
export type EventBusError =
  | { readonly kind: "name_invalid"; readonly name: string }
  | { readonly kind: "prefix_not_owned"; readonly name: string; readonly owner: ExtensionName }
  | { readonly kind: "read_undeclared"; readonly name: string }
  | { readonly kind: "scope_inactive"; readonly scopeId: ScopeId };

export interface BusEvent {
  /** 발행한 확장 */
  readonly from: ExtensionName;
  readonly name: string;
  readonly data: JsonValue;
}

export interface EventBus {
  emit<S>(g: ScopeApi<S>, name: string, data: JsonValue): Result<void, EventBusError>;
  /** 돌려주는 함수가 구독을 해제한다(멱등). scope가 꺼지면 자동으로 해제된다 */
  on<S>(
    g: ScopeApi<S>,
    name: string,
    listener: (event: BusEvent) => void,
  ): Result<Unsubscribe, EventBusError>;
}

interface Subscription {
  readonly pattern: string;
  readonly extension: ExtensionName;
  readonly scopeId: ScopeId;
  readonly generation: Generation;
  readonly listener: (event: BusEvent) => void;
}

const KIND_REGEX = new RegExp(RECORD_KIND_PATTERN);
const READ_REGEX = new RegExp(RECORD_KIND_READ_PATTERN);

function matches(pattern: string, name: string): boolean {
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

export function createEventBus(core: HostCore): EventBus {
  const subscriptions = new Set<Subscription>();

  return {
    emit(g, name, data) {
      const { record, generation } = scopeInternalsOf(g);
      if (generation.closed) return err({ kind: "scope_inactive", scopeId: record.id });
      if (!KIND_REGEX.test(name)) return err({ kind: "name_invalid", name });
      if (!name.startsWith(ownKindPrefix(record.manifest))) {
        return err({ kind: "prefix_not_owned", name, owner: record.extension });
      }
      const event: BusEvent = {
        from: record.extension,
        name,
        data: deepFreeze(structuredClone(data)),
      };
      for (const subscription of subscriptions) {
        if (!matches(subscription.pattern, name)) continue;
        core.track(
          Promise.resolve().then(() => {
            // 발행과 전달 사이에 세대가 닫혔으면 전달하지 않는다
            if (subscription.generation.closed) return undefined;
            try {
              withoutAmbient(() => {
                subscription.listener(event);
              });
            } catch (cause) {
              core.deps.report({
                level: "error",
                code: "handler_failed",
                scopeId: subscription.scopeId,
                extension: subscription.extension,
                message: `an event bus listener of ${subscription.scopeId} threw for ${name}`,
                cause,
              });
            }
            return undefined;
          }),
        );
      }
      return ok(undefined);
    },
    on(g, name, listener) {
      const { record, generation } = scopeInternalsOf(g);
      if (generation.closed) return err({ kind: "scope_inactive", scopeId: record.id });
      if (!KIND_REGEX.test(name) && !READ_REGEX.test(name)) {
        return err({ kind: "name_invalid", name });
      }
      if (!isKindReadable(record.manifest, name)) return err({ kind: "read_undeclared", name });
      const fiber = generation.fiber;
      if (fiber === null) return err({ kind: "scope_inactive", scopeId: record.id });
      const subscription: Subscription = {
        pattern: name,
        extension: record.extension,
        scopeId: record.id,
        generation,
        listener,
      };
      subscriptions.add(subscription);
      let removed = false;
      const off = (): void => {
        if (removed) return;
        removed = true;
        subscriptions.delete(subscription);
      };
      fiber.effect(() => off, `event-bus(${name})`);
      return ok(off);
    },
  };
}
