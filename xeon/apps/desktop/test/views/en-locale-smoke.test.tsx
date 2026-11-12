import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, t, type Locale } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import { CommandsContext } from "../../src/views/commands.ts";
import { ConnectionScreenView } from "../../src/views/pages/connection/connection-view.tsx";
import { setupRequiredText } from "../../src/views/setup-needed.ts";
import { fakeCommands } from "./fake-commands.ts";
import { DEV_BOX, localState, remoteOf } from "./hero-fixtures.ts";
import { HANDLERS, RUNNING } from "./reach-fixtures.ts";

// `l4.ui.locale=en` 데스크톱 스모크(T-I18N, Y15). 창을 띄우지 않고 서버 렌더로 본다: 로케일이 en이면 화면 문장이 영어 카탈로그에서 나오고
// 한글이 하나도 없어야 한다. 시험 프로세스는 ko로 시작하므로(scripts/test-preload.ts) 끝나면 되돌린다.

const HANGUL = /[ㄱ-ㆎ가-힣]/;
/** 이 컴퓨터, 다른 기기 접속이 켜져 도는 화면(구역 다섯이 모두 보인다). `onRemote`면 다른 컴퓨터에 붙은 화면이다 */
function connectionHtml(locale: Locale, onRemote = false): string {
  const state = onRemote
    ? localState({
        list: { kind: "ready" },
        items: [DEV_BOX],
        engineTarget: { kind: "remote", entry: DEV_BOX },
      })
    : localState({ list: { kind: "ready" } });
  return renderToString(
    <CommandsContext value={fakeCommands()}>
      <ShellStoreContext value={createShellStore(1400)}>
        <ConnectionScreenView
          state={state}
          engine={{ kind: "running", source: "service", pid: 4211 }}
          locale={locale}
          handlers={HANDLERS}
          remote={onRemote ? null : remoteOf([], { status: { kind: "ready", value: RUNNING } })}
        />
      </ShellStoreContext>
    </CommandsContext>,
  );
}

describe("desktop render with ui.locale=en", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("en");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("the remote settings screen renders English sentences and no Hangul", () => {
    const markup = connectionHtml("en");
    expect(markup).toContain(">This computer</h2>");
    expect(markup).toContain(`>${t("desktop.connection.keepOn.title")}</h2>`);
    expect(markup).toContain(`>${t("desktop.connection.computers.title")}</h2>`);
    expect(markup).toContain(`>${t("desktop.connection.devices.title")}</h2>`);
    expect(markup).toContain(`${t("desktop.connection.computers.add")}</button>`);
    expect(markup).not.toMatch(HANGUL);
  });

  test("the screen on another computer renders English sentences and no Hangul", () => {
    const markup = connectionHtml("en", true);
    expect(markup).toContain("dev-box");
    expect(markup).toContain(`>${t("desktop.connection.hero.backToLocal")}</button>`);
    expect(markup).not.toMatch(HANGUL);
  });

  test("the same screen renders Korean when the locale is ko", () => {
    setActiveLocale("ko");
    const markup = connectionHtml("ko");
    expect(markup).toContain(">이 컴퓨터</h2>");
    expect(markup).toContain(">이 컴퓨터를 계속 켜 두기</h2>");
    expect(markup).toContain("컴퓨터 추가</button>");
  });

  test("a .ts-built sentence follows the locale too", () => {
    expect(renderToString(<p>{setupRequiredText()}</p>)).not.toMatch(HANGUL);
  });
});
