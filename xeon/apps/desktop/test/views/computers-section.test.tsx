import { describe, expect, test } from "bun:test";
import type { TargetEntry } from "@fresnel/client";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import type { PreflightEvent } from "../../src/transport/ipc.ts";
import { CommandsContext } from "../../src/views/commands.ts";
import { ComputersSection } from "../../src/views/pages/connection/computers-section.tsx";
import {
  connectionReducer,
  INITIAL_CONNECTION_STATE,
  type ConnectionAction,
  type ConnectionState,
} from "../../src/views/pages/connection/connection-model.ts";
import {
  PROBE_IDLE,
  probeReducer,
  type ProbeAction,
  type RowProbe,
} from "../../src/views/pages/connection/connection-probe-model.ts";
import type { SectionContext } from "../../src/views/pages/connection/connection-sections.ts";
import { fakeCommands } from "./fake-commands.ts";
import { contextOf, localState } from "./hero-fixtures.ts";

// "다른 컴퓨터에 연결" 구역의 서버 렌더(시안 §5.1). 읽는 중·빈 상태·카드 격자·지금 쓰는 카드·연결 시험 결과·찾기·알림·웹 셸을
// 글과 data-slot, disabled 값으로 본다. 클릭은 DOM이 없어 못 보고, 상태 고르기는 `add-computer-model.test.ts`가 본다.

const WORK: TargetEntry = {
  id: "w",
  label: "work-mac",
  address: "ssh://dev@10.0.0.5:2222/run/f.sock",
};
const WEB: TargetEntry = { id: "b", label: "home", address: "wss://home.ts.net:8443" };

function stateWith(
  base: ConnectionState,
  ...actions: readonly ConnectionAction[]
): ConnectionState {
  return actions.reduce(connectionReducer, base);
}

function loaded(
  items: readonly TargetEntry[],
  base: ConnectionState = localState(),
): ConnectionState {
  return stateWith(base, { type: "targetsChanged", items, notice: null, added: false });
}

function html(patch: Partial<SectionContext>, rowProbe: RowProbe | null = null): string {
  const calls: string[] = [];
  return renderToString(
    <CommandsContext value={fakeCommands()}>
      <ComputersSection {...contextOf(calls, patch)} rowProbe={rowProbe} />
    </CommandsContext>,
  );
}

function buttonTagsNamed(markup: string, label: string): string[] {
  return Array.from(markup.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs))
    .filter((match) => match[2]?.replace(/<[^>]*>/g, "") === label)
    .map((match) => match[1] ?? "");
}

const isLocked = (tag: string): boolean => /\sdisabled=""/.test(tag);

function probeOf(...actions: readonly ProbeAction[]): RowProbe {
  return {
    id: WORK.id,
    probe: actions.reduce(probeReducer, probeReducer(PROBE_IDLE, { type: "begin" })),
  };
}

const step = (event: Partial<PreflightEvent> & Pick<PreflightEvent, "step">): ProbeAction => ({
  type: "step",
  event: { status: "pass", code: "ok", durationMs: 12, actions: [], ...event },
});

describe("computers section", () => {
  test("the header names the section and offers adding a computer", () => {
    const markup = html({ state: loaded([WORK]) });
    expect(markup).toContain(t("desktop.connection.computers.title"));
    expect(buttonTagsNamed(markup, t("desktop.connection.computers.add"))).toHaveLength(1);
  });

  test("while the list is read it shows card skeletons and says so", () => {
    const markup = html({ state: INITIAL_CONNECTION_STATE });
    expect(markup).toContain('data-slot="computers-loading"');
    expect(markup).toContain(t("desktop.connection.computers.loading"));
    expect(markup).not.toContain('data-slot="computers-empty"');
  });

  test("an empty list offers the two ways to start", () => {
    const markup = html({ state: loaded([]) });
    expect(markup).toContain('data-slot="computers-empty"');
    expect(markup).toContain(t("desktop.connection.computers.emptyTitle"));
    expect(buttonTagsNamed(markup, t("desktop.connection.computers.addSsh"))).toHaveLength(1);
    expect(buttonTagsNamed(markup, t("desktop.connection.computers.addWeb"))).toHaveLength(1);
  });

  test("a list that failed to load says so with a danger note", () => {
    const markup = html({ state: stateWith(localState(), { type: "targetsFailed" }) });
    expect(markup).toContain(t("desktop.connection.computers.loadFailed"));
    expect(markup).toContain('data-slot="setting-row-note"');
  });

  test("each saved computer is a card with its name, kind badge and a short address", () => {
    const markup = html({ state: loaded([WORK, WEB]) });
    expect(markup.split('data-slot="computer-card"').length - 1).toBe(2);
    expect(markup).toContain("work-mac");
    expect(markup).toContain(">dev@10.0.0.5:2222<");
    expect(markup).toContain(">home.ts.net:8443<");
    expect(markup).toContain(t("desktop.connection.computers.badge.ssh"));
    expect(markup).toContain(t("desktop.connection.computers.badge.web"));
    // 다른 카드에는 [연결]이 있고 연결 시험은 메뉴에 있다
    expect(buttonTagsNamed(markup, t("desktop.connection.computers.connect"))).toHaveLength(2);
    expect(buttonTagsNamed(markup, t("desktop.connection.computers.test"))).toHaveLength(0);
  });

  test("the card in use is marked, has no connect button and shows the test button", () => {
    const state = stateWith(loaded([WORK, WEB]), {
      type: "engineTargetSeen",
      target: { kind: "remote", address: WORK.address, label: WORK.label },
    });
    const markup = html({ state, remote: null });
    expect(markup).toContain('data-current=""');
    expect(markup).toContain(t("desktop.connection.computers.current"));
    expect(markup).toContain('data-tone="success"');
    expect(buttonTagsNamed(markup, t("desktop.connection.computers.connect"))).toHaveLength(1);
    expect(buttonTagsNamed(markup, t("desktop.connection.computers.test"))).toHaveLength(1);
  });

  test("while a switch is under way every connect button is locked", () => {
    const state = stateWith(loaded([WORK, WEB]), {
      type: "connectStarted",
      target: { kind: "remote", entry: WEB },
      observed: { engine: null, link: "live", connectError: null },
    });
    const markup = html({ state });
    // 바꾸려는 컴퓨터는 지금 쓰는 카드가 되어 [연결]이 없고, 나머지 [연결]은 잠긴다
    const tags = buttonTagsNamed(markup, t("desktop.connection.computers.connect"));
    expect(tags.map(isLocked)).toEqual([true]);
    expect(markup).toContain(t("desktop.connection.computers.connecting"));
  });

  test("a running test spreads its six check lines inside the card", () => {
    const markup = html({ state: loaded([WORK]) }, probeOf(step({ step: "resolve" })));
    expect(markup).toContain('data-slot="probe-view"');
    expect(markup).toContain('data-slot="check-steps" data-state="running"');
    expect(markup.split('data-slot="check-step"').length - 1).toBe(6);
    expect(markup).toContain(t("desktop.connection.computers.testLabel", { name: "work-mac" }));
  });

  test("a new host key stops the test with the trust box and a trust button", () => {
    const rowProbe = probeOf({
      type: "stopped",
      outcome: {
        ok: false,
        step: "connect",
        status: "action",
        code: "host_key_new",
        actions: ["trust_host_key"],
        detail: {
          hostKey: {
            fingerprint: "SHA256:abc",
            keyType: "ED25519",
            hostname: "10.0.0.5",
            port: 22,
            scanned: [],
          },
        },
      },
    });
    const markup = html({ state: loaded([WORK]) }, rowProbe);
    expect(markup).toContain('data-slot="host-key-box"');
    expect(markup).toContain("SHA256:abc");
    expect(buttonTagsNamed(markup, t("desktop.connection.add.hostKey.trust"))).toHaveLength(1);
  });

  test("an address test is one check line", () => {
    const rowProbe: RowProbe = {
      id: WEB.id,
      probe: probeReducer(probeReducer(PROBE_IDLE, { type: "begin" }), {
        type: "tested",
        outcome: { ok: true, code: "ok", durationMs: 42 },
      }),
    };
    const markup = html({ state: loaded([WEB]) }, rowProbe);
    expect(markup.split('data-slot="check-step"').length - 1).toBe(1);
    expect(markup).toContain(t("desktop.connection.computers.tested"));
    expect(markup).toContain("42ms");
  });

  test("past twenty computers a search box appears", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      id: `n${String(i)}`,
      label: `box-${String(i)}`,
      address: `ssh://me@box${String(i)}/run/f.sock`,
    }));
    expect(html({ state: loaded(many) })).toContain('type="search"');
    expect(html({ state: loaded(many.slice(0, 20)) })).not.toContain('type="search"');
  });

  test("a save notice sits above the cards", () => {
    const ok = stateWith(loaded([WORK]), {
      type: "notice",
      notice: { tone: "success", id: "desktop.connection.computers.added" },
    });
    const okMarkup = html({ state: ok });
    expect(okMarkup).toContain('data-slot="computers-notice" data-tone="success"');
    expect(okMarkup).toContain(t("desktop.connection.computers.added"));
    const bad = stateWith(loaded([WORK]), {
      type: "notice",
      notice: { tone: "danger", id: "desktop.connection.targets.saveFailed" },
    });
    expect(html({ state: bad })).toContain('data-slot="computers-notice" data-tone="danger"');
  });

  test("in the browser shell adding and connecting are hidden with one reason line", () => {
    const markup = html({ state: loaded([WORK]), web: true });
    expect(markup).toContain('data-slot="computers-web"');
    expect(markup).toContain(t("desktop.connection.computers.webOnly"));
    expect(buttonTagsNamed(markup, t("desktop.connection.computers.add"))).toHaveLength(0);
    expect(buttonTagsNamed(markup, t("desktop.connection.computers.connect"))).toHaveLength(0);
    expect(buttonTagsNamed(markup, t("desktop.connection.computers.test"))).toHaveLength(1);
    const empty = html({ state: loaded([]), web: true });
    expect(buttonTagsNamed(empty, t("desktop.connection.computers.addSsh"))).toHaveLength(0);
  });

  test("the section still shows when the engine is on another computer", () => {
    const markup = html({ state: loaded([WORK]), remote: null });
    expect(markup).toContain('data-slot="computers-section"');
  });
});
