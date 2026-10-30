import type { CapabilityId } from "@xeon/contracts/capabilities";
import type { ExtensionName } from "@xeon/contracts/extensions";
import type { CordisBridge, OpenedFiber } from "./cordis-bridge.ts";
import type { ExtDiagnostic } from "./errors.ts";
import { eachInOrder } from "./sequence.ts";
import { capabilityServiceName, providerServiceName } from "./services.ts";

/** 능력 바인딩(X.primitives.spec §3.7): 공급자 서비스를 inject해 `cap:<id>`로 다시 provide하는 내부 fiber */
export interface CapabilityBindings {
  /** 공급자 등록. 돌려주는 함수가 등록을 지운다(scope fiber의 effect 해제기로 쓴다) */
  addProvider(
    id: CapabilityId,
    provider: ExtensionName,
    version: string,
    keyVersion: string,
    /** 공급자가 내장 확장인가. 외부 확장의 `idempotent` 선언은 믿지 않는다(M3-REQ-31, X.loading-trust.spec §4.6.4) */
    builtin: boolean,
  ): () => void;
  /** 지금 바인딩된 공급자가 내장 확장이면 true. 바인딩이 없거나 외부 확장이면 false다(닫힌 쪽) */
  providerIsBuiltin(id: CapabilityId): boolean;
  /** 진행 중인 바인딩 변경이 끝나기를 기다린다 */
  settled(): Promise<void>;
  /** 모든 바인딩 fiber를 해제한다 */
  dispose(): Promise<void>;
}

interface ProviderInfo {
  readonly provider: ExtensionName;
  readonly version: string;
  readonly keyVersion: string;
  readonly builtin: boolean;
}

function majorOf(version: string): string {
  return version.split(".")[0] ?? "";
}

export function createCapabilityBindings(
  bridge: CordisBridge,
  report: (diagnostic: ExtDiagnostic) => void,
  /** x.primitives.capabilityProviders. 공급자가 여럿일 때 능력마다 고른 확장을 읽는다(P-27) */
  selection: () => Readonly<Record<string, ExtensionName>> = () => ({}),
): CapabilityBindings {
  const providers = new Map<CapabilityId, ProviderInfo[]>();
  const bound = new Map<
    CapabilityId,
    { readonly provider: ExtensionName; readonly fiber: OpenedFiber }
  >();
  let tail: Promise<void> = Promise.resolve();

  function chain(task: () => Promise<void>): void {
    tail = tail.then(task).catch((error: unknown) => {
      report({
        level: "error",
        code: "capability_ambiguous",
        message: "capability binding update failed",
        cause: error,
      });
    });
  }

  async function reconcile(id: CapabilityId): Promise<void> {
    // major가 다른 공급자는 후보에서 뺀다(F.capabilities.spec §5 1번)
    const all = providers.get(id) ?? [];
    const eligible = all.filter((info) => majorOf(info.version) === majorOf(info.keyVersion));
    for (const info of all) {
      if (!eligible.includes(info)) {
        report({
          level: "warning",
          code: "capability_unavailable",
          extension: info.provider,
          message: `provider ${info.provider} of ${id} is version ${info.version}, a different major than the key ${info.keyVersion}; it is excluded`,
        });
      }
    }
    const current = bound.get(id);
    const [only] = eligible;
    const chosen = selection()[id];
    const picked = eligible.find((info) => info.provider === chosen);
    const wanted =
      eligible.length === 1 && only !== undefined
        ? only.provider
        : eligible.length > 1
          ? picked?.provider
          : undefined;
    if (current !== undefined && current.provider === wanted) return;
    if (current !== undefined) {
      bound.delete(id);
      await current.fiber.dispose();
    }
    if (eligible.length > 1 && wanted === undefined) {
      report({
        level: "warning",
        code: "capability_ambiguous",
        message:
          chosen === undefined
            ? `capability ${id} has providers ${eligible.map((info) => info.provider).join(", ")}; set x.primitives.capabilityProviders`
            : `x.primitives.capabilityProviders names ${chosen} for ${id}, which is not one of ${eligible.map((info) => info.provider).join(", ")}`,
      });
      return;
    }
    if (wanted === undefined) return;
    const providerName = providerServiceName(id, wanted);
    const fiber = bridge.openFiber({
      name: `cap-binding:${id}`,
      inject: [providerName],
      apply: (handle) => {
        handle.provide(capabilityServiceName(id), handle.service(providerName));
        return Promise.resolve();
      },
    });
    bound.set(id, { provider: wanted, fiber });
    await fiber.settled;
  }

  return {
    providerIsBuiltin(id) {
      const current = bound.get(id);
      if (current === undefined) return false;
      return (providers.get(id) ?? []).some(
        (info) => info.provider === current.provider && info.builtin,
      );
    },
    addProvider(id, provider, version, keyVersion, builtin) {
      const list = providers.get(id) ?? [];
      const info: ProviderInfo = { provider, version, keyVersion, builtin };
      list.push(info);
      providers.set(id, list);
      chain(() => reconcile(id));
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        const current = providers.get(id) ?? [];
        const index = current.indexOf(info);
        if (index >= 0) current.splice(index, 1);
        if (current.length === 0) providers.delete(id);
        chain(() => reconcile(id));
      };
    },
    settled: () => tail,
    async dispose() {
      await tail;
      await eachInOrder([...bound.values()].toReversed(), async (entry) => {
        await entry.fiber.dispose();
        return "continue";
      });
      bound.clear();
    },
  };
}
