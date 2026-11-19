import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import { CommandsContext } from "../../src/views/commands.ts";
import type { ConnectionState } from "../../src/views/pages/connection/connection-model.ts";
import { ConnectionScreenView } from "../../src/views/pages/connection/connection-view.tsx";
import { a11yProblems } from "../lib/a11y-markup.ts";
import { fakeCommands } from "./fake-commands.ts";
import { DEV_BOX, localState, remoteOf } from "./hero-fixtures.ts";
import { HANDLERS, RUNNING } from "./reach-fixtures.ts";

// Y14 일부: 디자인이 바뀌지 않는 설정 "원격" 화면의 서버 렌더에서 이름 없는 단추·링크·입력란, alt 없는 이미지, 양수 tabindex가 없는지 본다.
// axe는 아니다(DOM이 없고 axe-core 의존을 더할 수 없다). 키보드 경로와 대비는 이 시험 밖이다.

function html(state: ConnectionState): string {
  return renderToStaticMarkup(
    <CommandsContext value={fakeCommands()}>
      <ShellStoreContext value={createShellStore(1400)}>
        <ConnectionScreenView
          state={state}
          engine={{ kind: "running", source: "service", pid: 4211 }}
          locale="ko"
          handlers={HANDLERS}
          inline
          remote={remoteOf([], { status: { kind: "ready", value: RUNNING } })}
        />
      </ShellStoreContext>
    </CommandsContext>,
  );
}

describe("the remote settings screen names every control", () => {
  test("this computer, with the service running", () => {
    const markup = html(localState({ list: { kind: "ready" } }));
    expect(markup).toContain("<button");
    expect(a11yProblems(markup)).toEqual([]);
  });

  test("another computer is the target", () => {
    const markup = html(
      localState({
        list: { kind: "ready" },
        items: [DEV_BOX],
        engineTarget: { kind: "remote", entry: DEV_BOX },
      }),
    );
    expect(markup).toContain("<button");
    expect(a11yProblems(markup)).toEqual([]);
  });
});
