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
import { SafeModeActions, SafeModeChip } from "../../src/views/safe-mode-chip.tsx";
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
    readonly remote?: boolean;
  },
): string {
  const ui = createUiStore();
  return renderToString(
    <ShellRestartContext value={options.shell}>
      <SafeModeContext value={options.snapshot}>
        <Providers
          engine={engineReadOf(options.running)}
          ui={ui.read}
          commands={fakeCommands(
            options.remote === true
              ? {
                  restore: {
                    ...fakeCommands().restore,
                    engineTarget: () => ({ kind: "remote", address: "tcp://host:1234" }),
                  },
                }
              : {},
          )}
        >
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

/** 상태 칸 단추 하나의 마크업(`data-bar-cell`부터 닫는 단추 전까지). 칸이 없으면 빈 글 */
function cellOf(markup: string, cellId: string): string {
  const start = markup.indexOf(`data-bar-cell="${cellId}"`);
  if (start < 0) return "";
  const end = markup.indexOf("</button>", start);
  return markup.slice(start, end < 0 ? undefined : end);
}

/** 칸의 점 값(`data-bar-dot`). 점이 없으면 null */
function dotOf(cell: string): string | null {
  return /data-bar-dot="([^"]+)"/.exec(cell)?.[1] ?? null;
}

/** 칸에 보이는 글. 글 칸은 숫자와 같이 `tabular-nums` 줄 뒤에 온다 */
function textOf(cell: string): string | null {
  return /tabular-nums">([^<]*)</.exec(cell)?.[1] ?? null;
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

  test("a remote target gets only the restart-as-is button and a body that points to the service machine", () => {
    const html = render(<SafeModeCard />, {
      snapshot: SUGGEST,
      shell: true,
      running: true,
      remote: true,
    });
    expect(html).toContain("엔진 연속 시작 실패 3회");
    expect(html).toContain("그대로 다시 시작</button>");
    expect(html).not.toContain("안전 모드로 시작</button>");
    expect(html).toContain("원격 서비스는 서비스가 있는 기기에서 안전 모드로 시작해야 해요.");
    expect(html).not.toContain("안전 모드로 시작하면 기본 에이전트만 띄워요.");
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

  // Popover 본문은 열 때만 그려지므로 칸은 닫힌 모양(표지 글과 점)을 보고, 본문은 `SafeModeActions`를 직접 그린다.
  // 칸 설명(꺼진 것과 원인)은 `safeModeTipOf`가 만들고 safe-mode-model 시험이 값을 본다.

  test("in safe mode the chip is a status cell with a warning dot and the words", () => {
    const html = render(<SafeModeChip />, { snapshot: SAFE, shell: true, running: true });
    const cell = cellOf(html, "safe-mode");
    expect(dotOf(cell)).toBe("warning");
    expect(textOf(cell)).toBe("안전 모드");
    expect(html).not.toContain('data-slot="safe-mode-chip"');
  });

  test("in the shell the popover body holds the turn-off button enabled, and the setting note behind an info icon", () => {
    const html = render(<SafeModeActions />, { snapshot: SAFE, shell: true, running: true });
    expect(isDisabled(buttonOf(html, "안전 모드 끄고 다시 시작"))).toBe(false);
    expect(html).toContain("설정의 기본값은 그대로라서 앱을 다시 켜면 안전 모드로 열려요.");
    expect(html).toContain("설명 보기");
  });

  test("a safe mode from a launch option or startup failures has the button but not the setting note", () => {
    for (const cause of ["flag", "startupFailures"] as const) {
      const html = render(<SafeModeActions />, {
        snapshot: { ...SAFE, cause },
        shell: true,
        running: true,
      });
      expect(isDisabled(buttonOf(html, "안전 모드 끄고 다시 시작"))).toBe(false);
      expect(html).not.toContain("설정의 기본값은 그대로라서");
    }
  });

  test("the turn-off button waits until the engine runs or has failed", () => {
    const starting = render(<SafeModeActions />, {
      snapshot: SAFE,
      shell: true,
      running: false,
    });
    expect(isDisabled(buttonOf(starting, "안전 모드 끄고 다시 시작"))).toBe(true);
  });

  test("on the web the chip keeps its dot and words, and the body draws nothing", () => {
    const html = render(<SafeModeChip />, { snapshot: SAFE, shell: false, running: true });
    const cell = cellOf(html, "safe-mode");
    expect(dotOf(cell)).toBe("warning");
    expect(textOf(cell)).toBe("안전 모드");
    expect(render(<SafeModeActions />, { snapshot: SAFE, shell: false, running: true })).toBe("");
  });

  test("the chip is hidden when safe mode is off, even with a suggestion", () => {
    expect(render(<SafeModeChip />, { snapshot: SUGGEST, shell: true, running: true })).toBe("");
    expect(render(<SafeModeChip />, { snapshot: null, shell: true, running: true })).toBe("");
    expect(render(<SafeModeChip />, { snapshot: SUGGEST, shell: false, running: true })).toBe("");
  });
});
