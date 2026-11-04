import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import type { EngineMirror } from "../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore } from "../../src/state/ui/index.ts";
import type { SafeModeSnapshot } from "../../src/views/commands.ts";
import { Providers } from "../../src/views/providers.tsx";
import { SafeModeCard } from "../../src/views/safe-mode-card.tsx";
import { SafeModeChip } from "../../src/views/safe-mode-chip.tsx";
import { SafeModeContext } from "../../src/views/safe-mode-context.ts";
import { ShellRestartContext } from "../../src/views/shell-restart-context.ts";
import { harness } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// 안전 모드 카드와 칩을 서버 렌더로 본다. 서버 렌더는 효과를 돌리지 않으므로 스냅샷은 `SafeModeContext`로 직접 준다.
// 엔진이 running일 때만 단추가 눌린다. 정보 아이콘 뒤 글은 `InfoTip`이 숨긴 글(sr-only)로도 나오므로 그 자리에서 찾는다.

const SUGGEST: SafeModeSnapshot = { active: false, cause: null, startupFailures: 3, suggest: true };
const SAFE: SafeModeSnapshot = { active: true, cause: "user", startupFailures: 0, suggest: false };

/**
 * 엔진 거울의 읽기 면. 서버 렌더는 스토어의 초기 값을 읽으므로(`getInitialState`) 고른 상태를 두 값으로 둔다.
 * `running`이면 엔진이 running인 거울, 아니면 시작 전 거울이다.
 */
function engineReadOf(running: boolean): ReadonlyStore<EngineMirror> {
  const h = harness();
  if (running) {
    h.store.ingest({ type: "engine", state: { kind: "running", source: "sidecar", pid: 1 } });
    h.store.flush();
  }
  const state = h.store.read.getState();
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => undefined };
}

/** 자리를 그린 글. 셸 여부, 스냅샷, 엔진이 running인지를 고른다 */
function render(
  node: ReactNode,
  options: {
    readonly snapshot: SafeModeSnapshot | null;
    readonly shell: boolean;
    readonly running: boolean;
  },
): string {
  const ui = createUiStore();
  return renderToString(
    <ShellRestartContext value={options.shell}>
      <SafeModeContext value={options.snapshot}>
        <Providers engine={engineReadOf(options.running)} ui={ui.read} commands={fakeCommands()}>
          {node}
        </Providers>
      </SafeModeContext>
    </ShellRestartContext>,
  );
}

/** 라벨을 가진 단추의 여는 태그와 글. 단추 밖의 같은 글(본문 등)은 잡지 않는다 */
function buttonOf(markup: string, label: string): string {
  const end = markup.indexOf(`${label}</button>`);
  if (end < 0) return "";
  return markup.slice(markup.lastIndexOf("<button", end), end);
}

/** 단추가 누를 수 없는지. 클래스의 `disabled:` 변형과 구분하려고 속성을 본다 */
function isDisabled(button: string): boolean {
  return button.includes(' disabled=""');
}

describe("the safe mode suggestion card", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("a suggestion in the shell shows the alert with the count, the body, the failure row, and both buttons", () => {
    const html = render(<SafeModeCard />, { snapshot: SUGGEST, shell: true, running: false });
    expect(html).toContain('role="alert"');
    expect(html).toContain("엔진 연속 시작 실패 3회");
    expect(html).toContain("안전 모드로 시작하면 기본 에이전트만 띄워요.");
    expect(html).toMatch(/연속 시작 실패<\/dt><dd[^>]*><span[^>]*>3<\/span>/);
    expect(html).toContain("그대로 다시 시작</button>");
    expect(html).toContain("안전 모드로 시작</button>");
  });

  test("the long explanation sits behind the info icon, and the sentence is still in the markup for screen readers", () => {
    const html = render(<SafeModeCard />, { snapshot: SUGGEST, shell: true, running: false });
    expect(html).toContain("원인을 끄거나 고친 뒤 다시 켤 수 있어요.");
    expect(html).toContain("설명 보기");
  });

  test("the buttons wait until the engine runs or has failed", () => {
    const starting = render(<SafeModeCard />, { snapshot: SUGGEST, shell: true, running: false });
    expect(isDisabled(buttonOf(starting, "안전 모드로 시작"))).toBe(true);
    expect(isDisabled(buttonOf(starting, "그대로 다시 시작"))).toBe(true);
    const running = render(<SafeModeCard />, { snapshot: SUGGEST, shell: true, running: true });
    expect(isDisabled(buttonOf(running, "안전 모드로 시작"))).toBe(false);
    expect(isDisabled(buttonOf(running, "그대로 다시 시작"))).toBe(false);
  });

  test("nothing shows on the web, without a suggestion, or while in safe mode", () => {
    expect(render(<SafeModeCard />, { snapshot: SUGGEST, shell: false, running: true })).toBe("");
    expect(
      render(<SafeModeCard />, {
        snapshot: { ...SUGGEST, suggest: false },
        shell: true,
        running: true,
      }),
    ).toBe("");
    expect(render(<SafeModeCard />, { snapshot: SAFE, shell: true, running: true })).toBe("");
    expect(render(<SafeModeCard />, { snapshot: null, shell: true, running: true })).toBe("");
  });
});

describe("the safe mode chip in the status bar", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("in safe mode the shell shows the chip, the cause in the tip, and the turn-off button", () => {
    const html = render(<SafeModeChip />, { snapshot: SAFE, shell: true, running: true });
    expect(html).toContain('data-slot="safe-mode-chip"');
    expect(html).toContain("안전 모드</span>");
    expect(html).toContain("꺼진 것: 그룹, 사용자·프로젝트 확장, X 훅. 원인: 직접 켰어요");
    expect(isDisabled(buttonOf(html, "안전 모드 끄고 다시 시작"))).toBe(false);
    expect(html).toContain("설정에서 안전 모드를 기본으로 켜 두었다면 설정을 먼저 바꿔 주세요.");
  });

  test("the turn-off button waits until the engine runs or has failed", () => {
    const starting = render(<SafeModeChip />, { snapshot: SAFE, shell: true, running: false });
    expect(isDisabled(buttonOf(starting, "안전 모드 끄고 다시 시작"))).toBe(true);
  });

  test("on the web the chip stays but the button and its note do not", () => {
    const html = render(<SafeModeChip />, { snapshot: SAFE, shell: false, running: true });
    expect(html).toContain('data-slot="safe-mode-chip"');
    expect(html).not.toContain("안전 모드 끄고 다시 시작");
    expect(html).not.toContain("설정에서 안전 모드를 기본으로");
  });

  test("the chip is hidden when safe mode is off, even with a suggestion", () => {
    expect(render(<SafeModeChip />, { snapshot: SUGGEST, shell: true, running: true })).toBe("");
    expect(render(<SafeModeChip />, { snapshot: null, shell: true, running: true })).toBe("");
  });
});
