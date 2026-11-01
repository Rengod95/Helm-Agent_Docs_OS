import type { ExtensionEntry, ScopeApi } from "@xeon/contracts/extensions";
import type { TestHost } from "@xeon/ext-host/testing";
import type { GroupApi, GroupManifest } from "../../src/index.ts";
import { realHostAccess, wrap, type GroupHostAccess } from "../../src/wrap.ts";

/** 실제 hostOf 접근을 바탕으로 일부 연산만 바꾼다. delegate 시험이 L1 위임 서비스와 호출 문맥을 넣는 자리다 */
export type AccessOverride = (api: ScopeApi<never>) => Partial<GroupHostAccess>;

/**
 * defineGroup이 하는 일을 그대로 하되 hostAccess를 시험이 정한다. setup 안에서 받은 GroupApi는 sink에 담는다.
 * 설치까지 마치고 GroupApi를 돌려준다
 */
export async function installInjected(
  t: TestHost,
  manifest: GroupManifest,
  override: AccessOverride,
  setup?: (g: GroupApi<never>) => void,
  loadIndex = 0,
): Promise<GroupApi<never>> {
  const sink: { api?: GroupApi<never> } = {};
  const entry: ExtensionEntry = ({ scope }) => {
    scope(manifest.name, {}, (api: ScopeApi<never>) => {
      const wrapped = wrap(api, { manifest }, (target) => ({
        ...realHostAccess(target),
        ...override(api),
      }));
      sink.api = wrapped;
      setup?.(wrapped);
    });
  };
  await t.host.install({ manifest, entry, loadIndex, builtin: true });
  await t.settled();
  if (sink.api === undefined) throw new TypeError(`group ${manifest.name} did not run setup`);
  return sink.api;
}
