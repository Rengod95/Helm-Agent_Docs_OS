import { expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import { createUiStore } from "../../src/state/ui/index.ts";
import { Providers } from "../../src/views/providers.tsx";
import { PermissionModePanel } from "../../src/views/pages/settings/settings-rules-panel.tsx";
import { harness } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";
import { defOf, settingOf, viewOf } from "./settings-fixtures.ts";

// 설정 "권한" 구역의 실행 방식 자리(pfMode). 실행 방식은 프로필이 정하므로 [결정: 2026-11-23 사용자, AGE-71 질문 3] 이 자리에는 고르는 카드가 없고,
// 한 줄 안내와 프로필 화면으로 가는 단추, 그리고 "모두 허용"의 허락 줄만 있다. 서버 렌더로 그린 글을 비교한다(누르기는 DOM이 없어 보지 않는다).

const NOOP = (): void => {};

const MODE = defOf(
  "l1.tools.permissionMode",
  "permissions",
  "select",
  { type: "string" },
  { range: { enum: ["default", "acceptEdits", "bypass"] } },
  { order: 10, label: "Permission mode" },
);
const BYPASS = defOf(
  "l1.tools.bypassAllowed",
  "permissions",
  "toggle",
  { type: "boolean" },
  {},
  { order: 11, label: "Bypass allowed" },
);

function html(bypassAllowed: boolean): string {
  const h = harness();
  h.store.ingest({ type: "engine", state: { kind: "running", source: "sidecar", pid: 1 } });
  h.store.flush();
  const state = h.store.read.getState();
  const engine = {
    getState: () => state,
    getInitialState: () => state,
    subscribe: () => () => undefined,
  };
  const view = viewOf(
    [MODE, BYPASS],
    [
      settingOf(MODE.key, "default"),
      settingOf(BYPASS.key, bypassAllowed, {
        source: { scope: "managed", path: "/etc/fresnel/managed.json" },
        locked: true,
      }),
    ],
  );
  return renderToString(
    <Providers engine={engine} ui={createUiStore().read} commands={fakeCommands()}>
      <ShellStoreContext value={createShellStore(1280)}>
        <PermissionModePanel
          view={view}
          live
          saved={new Set()}
          editors={{}}
          handlers={{
            edit: NOOP,
            change: NOOP,
            commit: NOOP,
            discard: NOOP,
            keepDraft: NOOP,
            reset: NOOP,
          }}
        />
      </ShellStoreContext>
    </Providers>,
  );
}

test("the run mode section says the profile decides it and offers the profile screen, with no mode cards", () => {
  const out = html(true);
  expect(out).toContain(t("desktop.settings.perm.mode.title"));
  expect(out).toContain(t("desktop.settings.perm.mode.inProfile"));
  expect(out).toContain(t("desktop.settings.perm.mode.openProfile"));
  expect(out).not.toContain('role="radiogroup"');
  expect(out).not.toContain(t("settings.l1.tools.permissionMode.option.acceptEdits"));
});

test("the managed allow-all permission line stays under the notice", () => {
  expect(html(true)).toContain(t("desktop.settings.perm.mode.bypassOn"));
  expect(html(false)).toContain(t("desktop.settings.perm.mode.bypassOff"));
  // 잠금은 그 줄의 자물쇠와 상태 글이 말한다. 같은 뜻의 경고 줄을 또 두지 않는다
  expect(html(true)).not.toContain('role="note"');
});
