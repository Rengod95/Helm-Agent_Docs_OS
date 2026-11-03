// 플러그인 화면 시험의 공용 도구: 목록을 아직 읽지 않은 문맥과 `ext.ui.list`를 읽은 문맥. 서버 렌더는 효과를 돌리지 않는다.
import { err, ok } from "@fresnel/contracts";
import type { ExtListResult, ExtUiEntry, HostConnection } from "@fresnel/contracts/wire";
import { createPluginUiRuntime } from "../../../src/plugin-ui/runtime.ts";
import { createConfirmQueue } from "../../../src/views/plugin/confirm-host.tsx";
import type { PluginUiContextValue } from "../../../src/views/plugin/plugin-context.tsx";
import { fakeConnection } from "../../state/fake-connection.ts";

/** 연결이 없는 플러그인 문맥. 목록은 비어 있다 */
export function emptyPluginUi(): PluginUiContextValue {
  const runtime = createPluginUiRuntime({
    withConnection: () => Promise.resolve(err({ kind: "offline" })),
    appRootsInvoke: undefined,
    framesSupported: false,
  });
  return { runtime, confirm: createConfirmQueue() };
}

/** `ext.ui.list`, `ext.list`, `settings.get`에 답하는 연결로 목록을 한 번 읽은 플러그인 문맥 */
export async function loadedPluginUi(
  entries: readonly ExtUiEntry[],
  extensions: ExtListResult["extensions"] = [],
): Promise<PluginUiContextValue> {
  const fake = fakeConnection({
    "ext.ui.list": () => Promise.resolve({ items: [...entries] }),
    "ext.list": () => Promise.resolve({ extensions: [...extensions] }),
    "settings.get": () => Promise.resolve({ settings: [] }),
  });
  const runtime = createPluginUiRuntime({
    withConnection: async <T,>(run: (connection: HostConnection) => Promise<T>) =>
      ok(await run(fake.connection)),
    appRootsInvoke: undefined,
    framesSupported: true,
  });
  await runtime.refresh();
  return { runtime, confirm: createConfirmQueue() };
}
