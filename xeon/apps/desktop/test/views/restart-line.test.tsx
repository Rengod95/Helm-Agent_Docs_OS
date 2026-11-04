import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { createUiStore, type RestartReason } from "../../src/state/ui/index.ts";
import { Providers } from "../../src/views/providers.tsx";
import { RestartLine } from "../../src/views/restart-line.tsx";
import { ShellRestartContext } from "../../src/views/shell-restart-context.ts";
import { openedHarness } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// 상태 표시줄의 다시 시작 줄을 서버 렌더로 본다. 서버 렌더는 스토어의 초기 값을 읽으므로 엔진은 시작 전이다.
// 그래서 단추는 나오지 않아야 하고(엔진이 running일 때만 보인다), 글과 개수는 이유 목록대로 나와야 한다.

const ONE: readonly RestartReason[] = [{ kind: "install", name: "alpha" }];

function lineHtml(reasons: readonly RestartReason[], shellRestart: boolean): string {
  const h = openedHarness();
  const ui = createUiStore();
  return renderToString(
    <ShellRestartContext value={shellRestart}>
      <Providers engine={h.store.read} ui={ui.read} commands={fakeCommands()}>
        <RestartLine reasons={reasons} />
      </Providers>
    </ShellRestartContext>,
  );
}

describe("restart line in the status bar", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("with nothing needed it renders nothing", () => {
    expect(lineHtml([], true)).toBe("");
  });

  test("a desktop shell shows the title and the count, and no button until the engine runs", () => {
    const html = lineHtml(ONE, true);
    expect(html).toContain("다시 시작 대기");
    expect(html).toContain("1개 변경이 다시 시작한 뒤에 적용돼요");
    expect(html).not.toContain("지금 다시 시작");
  });

  test("a web shell shows only the one service line and no button", () => {
    const html = lineHtml(ONE, false);
    expect(html).toContain("서비스를 다시 시작해야 해요");
    expect(html).not.toContain("다시 시작 대기");
    expect(html).not.toContain("지금 다시 시작");
  });
});
