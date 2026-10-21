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
  ): () => void;
  /** 진행 중인 바인딩 변경이 끝나기를 기다린다 */
  settled(): Promise<void>;
  /** 모든 바인딩 fiber를 해제한다 */
  dispose(): Promise<void>;
}

interface ProviderInfo {
  readonly provider: ExtensionName;
  readonly version: string;
  readonly keyVersion: string;
}

function majorOf(version: string): string {
  return version.split(".")[0] ?? "";
}

export function createCapabilityBindings(
  bridge: CordisBridge,
  report: (diagnostic: ExtDiagnostic) => void,
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
    const eligible = (providers.get(id) ?? []).filter(
      (info) => majorOf(info.version) === majorOf(info.keyVersion),
    );
    const current = bound.get(id);
    const [only] = eligible;
    const wanted = eligible.length === 1 && only !== undefined ? only.provider : undefined;
    if (current !== undefined && current.provider === wanted) return;
    if (current !== undefined) {
      bound.delete(id);
      await current.fiber.dispose();
    }
    if (eligible.length > 1) {
      report({
        level: "warning",
        code: "capability_ambiguous",
        message: `capability ${id} has providers ${eligible.map((info) => info.provider).join(", ")}; set x.primitives.capabilityProviders`,
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
    addProvider(id, provider, version, keyVersion) {
      const list = providers.get(id) ?? [];
      const info: ProviderInfo = { provider, version, keyVersion };
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
