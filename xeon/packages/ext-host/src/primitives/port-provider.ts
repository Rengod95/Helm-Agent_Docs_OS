import type { PortKey } from "@xeon/contracts/extensions";
import type { FiberHandle } from "./cordis-bridge.ts";
import { PrimitiveError } from "./errors.ts";

/**
 * fiber 하나가 xeon.* 서비스를 제공하는 도구. Cordis는 서비스 이름 하나에 공급자 하나만 허용한다.
 * 키에 member가 있으면(xeon.session의 ext, projectors) 같은 이름의 포트들을 한 객체로 묶어 한 번만 provide한다
 * (X.primitives.spec §3.6, F.extensions.spec §3.2.1 PortKey.member)
 */
export interface PortProvider {
  provide<Api>(key: PortKey<Api>, impl: Api): void;
}

function provideService(fiber: FiberHandle, name: string, value: unknown): void {
  try {
    fiber.provide(name, value);
  } catch (cause) {
    // 같은 서비스 이름을 다른 공급자가 이미 provide했다
    throw new PrimitiveError("service_reserved", `service ${name} already has a provider`, {
      cause,
    });
  }
}

export function createPortProvider(fiber: FiberHandle): PortProvider {
  const bodies = new Map<string, Record<string, unknown>>();
  const wholes = new Set<string>();
  return {
    provide(key, impl) {
      if (key.member === undefined) {
        if (bodies.has(key.name) || wholes.has(key.name)) {
          throw new PrimitiveError(
            "service_reserved",
            `service ${key.name} is already provided here`,
          );
        }
        wholes.add(key.name);
        provideService(fiber, key.name, impl);
        return;
      }
      if (wholes.has(key.name)) {
        throw new PrimitiveError(
          "service_reserved",
          `service ${key.name} is already provided whole`,
        );
      }
      let body = bodies.get(key.name);
      if (body === undefined) {
        body = {};
        bodies.set(key.name, body);
        provideService(fiber, key.name, body);
      }
      if (key.member in body) {
        throw new PrimitiveError(
          "service_reserved",
          `port ${key.name}.${key.member} is already provided`,
        );
      }
      body[key.member] = impl;
    },
  };
}
