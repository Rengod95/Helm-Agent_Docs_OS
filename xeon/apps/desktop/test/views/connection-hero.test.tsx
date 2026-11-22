import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { FAKE_OFF_STATUS } from "../../src/app/remote/fake-remote-adapter.ts";
import type {
  HeroExtras,
  SectionContext,
} from "../../src/views/pages/connection/connection-sections.ts";
import {
  addressKindOf,
  addressSummaryOf,
  attachedCountOf,
  ConnectionHero,
  heroStatusOf,
} from "../../src/views/pages/connection/connection-hero.tsx";
import { timeTextOf } from "../../src/views/pages/connection/connection-text.ts";
import {
  contextOf,
  DEV_BOX,
  localState,
  remoteOf,
  snapshotOf,
  STOPPED_SERVICE,
} from "./hero-fixtures.ts";

// 요약 카드 "지금 쓰는 컴퓨터"(시안 dzRW §3)를 서버 렌더로 그려 상태별 글·data-slot·disabled를 값으로 본다.

/** 잠긴 단추·스위치의 속성(class의 `disabled:` 변형과 구분한다) */
const DISABLED = 'disabled=""';

const NO_EXTRAS: HeroExtras = { reconnect: [], targetNotice: null };

function render(context: SectionContext, extras: HeroExtras = NO_EXTRAS): string {
  return renderToStaticMarkup(<ConnectionHero {...context} {...extras} />);
}

/** data-slot 요소 안의 글(태그를 걷어 낸다) */
function slotText(html: string, slot: string): string | null {
  const match = new RegExp(`data-slot="${slot}"[^>]*>([\\s\\S]*?)</(?:div|p|span)>`).exec(html);
  return match === null ? null : (match[1] ?? "").replace(/<[^>]+>/g, "");
}

/** 글이 여러 조각(span)으로 나뉜 문단 칸의 글. 조각 사이 빈칸은 그대로 남는다 */
function paragraphText(html: string, slot: string): string | null {
  const match = new RegExp(`data-slot="${slot}"[^>]*>([\\s\\S]*?)</p>`).exec(html);
  return match === null ? null : (match[1] ?? "").replace(/<[^>]+>/g, "");
}

/** 통계 칸 하나의 값(dd 글) */
function statValue(html: string, slot: string): string | null {
  const match = new RegExp(`data-slot="${slot}"[\\s\\S]*?<dd[^>]*>([\\s\\S]*?)</dd>`).exec(html);
  return match === null ? null : (match[1] ?? "").replace(/<[^>]+>/g, "");
}

function buttonOf(html: string, label: string): string | null {
  const match = new RegExp(`<button[^>]*>(?:(?!</?button)[\\s\\S])*?${label}`).exec(html);
  return match === null ? null : match[0];
}

describe("heroStatusOf", () => {
  test("running engine on this computer is running, not connected", () => {
    expect(heroStatusOf(localState(), { kind: "running", source: "service", pid: 1 })).toEqual({
      tone: "success",
      label: "desktop.connection.hero.state.running",
    });
  });

  test("restarting engine is reconnecting, failed is disconnected, loading is null", () => {
    const restarting = {
      kind: "restarting",
      attempt: 3,
      retryAt: "2026-11-12T05:10:05.000Z",
      lastExit: { code: 1, signal: null, at: "2026-11-12T05:10:00.000Z" },
    } as const;
    expect(heroStatusOf(localState(), restarting)?.tone).toBe("warning");
    expect(
      heroStatusOf(localState(), { kind: "failed", attempts: 3, lastExit: restarting.lastExit })
        ?.tone,
    ).toBe("danger");
    expect(heroStatusOf(localState({ status: { kind: "loading" } }), null)).toBeNull();
  });
});

describe("attachedCountOf and addressSummaryOf", () => {
  test("count comes from the clients list first, then host connections", () => {
    expect(attachedCountOf(localState())).toBe(2);
    expect(
      attachedCountOf(
        localState({
          clients: {
            kind: "ready",
            clients: [
              {
                connectionId: "c1",
                transport: "in-process",
                writeThreads: 0,
                observedThreads: 0,
                self: true,
              },
            ],
          },
        }),
      ),
    ).toBe(1);
    expect(attachedCountOf(localState({ status: { kind: "loading" } }))).toBeNull();
  });

  test("ssh address reads as kind and user@host", () => {
    expect(addressKindOf(DEV_BOX.address)).toBe(t("desktop.connection.host.badge.ssh"));
    expect(addressSummaryOf(DEV_BOX.address)).toBe("dev@10.0.0.5");
  });
});

describe("ConnectionHero", () => {
  test("local service: this computer, running, summary, four stats, no back button", () => {
    const calls: string[] = [];
    const html = render(contextOf(calls));
    expect(html).toContain(t("desktop.connection.targets.local"));
    expect(slotText(html, "hero-state")).toBe(t("desktop.connection.hero.state.running"));
    expect(slotText(html, "hero-summary")).toBe(
      t("desktop.connection.hero.summary.service", {
        time: timeTextOf("2026-11-12T05:10:00.000Z", "ko"),
      }),
    );
    expect(statValue(html, "hero-stat-devices")).toBe(
      t("desktop.connection.hero.stat.devicesValue", { count: 2 }),
    );
    expect(statValue(html, "hero-stat-turns")).toBe(
      t("desktop.connection.hero.stat.turnsValue", { count: 1 }),
    );
    expect(statValue(html, "hero-stat-version")).toBe("0.4.1");
    expect(statValue(html, "hero-stat-access")).toBe(t("desktop.connection.hero.access.off"));
    expect(buttonOf(html, t("desktop.connection.hero.backToLocal"))).toBeNull();
    // 4칸은 카드 폭 448 이상에서, 그보다 좁으면 2×2
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("@[28rem]:grid-cols-4");
  });

  test("in-process: summary says inside the app", () => {
    const html = render(
      contextOf([], {
        state: localState({ service: STOPPED_SERVICE }),
        engine: { kind: "running", source: "sidecar", pid: 1 },
      }),
    );
    expect(slotText(html, "hero-summary")).toBe(
      t("desktop.connection.hero.summary.inProcess", {
        time: timeTextOf("2026-11-12T05:10:00.000Z", "ko"),
      }),
    );
    expect(statValue(html, "hero-stat-version")).toBe("—");
  });

  test("access on reads 켜짐", () => {
    const html = render(
      contextOf([], {
        remote: remoteOf([], {
          status: { kind: "ready", value: { ...FAKE_OFF_STATUS, enabled: true, state: "running" } },
        }),
      }),
    );
    expect(statValue(html, "hero-stat-access")).toBe(t("desktop.connection.hero.access.on"));
  });

  test("remote connected: saved name, mono address, back button enabled, unknown version", () => {
    const html = render(
      contextOf([], {
        state: localState({
          engineTarget: { kind: "remote", entry: DEV_BOX },
          status: { kind: "ready", snapshot: snapshotOf("service", { kind: "unknown" }) },
          service: { kind: "unknown" },
        }),
        remote: null,
      }),
    );
    expect(html).toContain("dev-box");
    expect(paragraphText(html, "hero-address")).toBe(
      `${t("desktop.connection.host.badge.ssh")} ${addressSummaryOf(DEV_BOX.address)}`,
    );
    expect(slotText(html, "hero-state")).toBe(t("desktop.connection.hero.state.connected"));
    const back = buttonOf(html, t("desktop.connection.hero.backToLocal"));
    expect(back).not.toBeNull();
    expect(back).not.toContain(DISABLED);
    expect(statValue(html, "hero-stat-version")).toBe("—");
    expect(statValue(html, "hero-stat-access")).toBe("—");
  });

  test("reconnecting: attempt line and alive line", () => {
    const html = render(
      contextOf([], {
        state: localState({ engineTarget: { kind: "remote", entry: DEV_BOX } }),
        engine: {
          kind: "restarting",
          attempt: 3,
          retryAt: "2026-11-12T05:10:05.000Z",
          lastExit: { code: 1, signal: null, at: "2026-11-12T05:10:00.000Z" },
        },
        remote: null,
      }),
      {
        reconnect: [{ kind: "attempt", attempt: 3, seconds: 5 }, { kind: "alive" }],
        targetNotice: null,
      },
    );
    expect(slotText(html, "hero-state")).toBe(t("desktop.connection.hero.state.reconnecting"));
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain(
      t("desktop.connection.hero.reconnect.attempt", { attempt: 3, seconds: 5 }),
    );
    expect(html).toContain(t("desktop.connection.hero.reconnect.alive"));
  });

  test("connecting: step line with the target name, back button locked", () => {
    const html = render(
      contextOf([], {
        state: localState({
          engineTarget: { kind: "remote", entry: DEV_BOX },
          pending: {
            target: { kind: "remote", entry: DEV_BOX },
            prior: { kind: "local" },
            stage: "starting",
            attempt: 0,
            from: { engine: "running", link: "live" },
            moved: true,
          },
        }),
        remote: null,
      }),
    );
    expect(slotText(html, "hero-state")).toBe(t("desktop.connection.hero.state.connecting"));
    expect(html).toContain(
      t("desktop.connection.hero.connecting", {
        name: "dev-box",
        step: t("desktop.connection.step.start"),
      }),
    );
    expect(buttonOf(html, t("desktop.connection.hero.backToLocal"))).toContain(DISABLED);
  });

  test("disconnected after a failed attach: danger state, failure note with retry", () => {
    const html = render(
      contextOf([], {
        state: localState({
          engineTarget: { kind: "remote", entry: DEV_BOX },
          status: { kind: "offline" },
          failure: {
            kind: "refused",
            target: { kind: "remote", entry: DEV_BOX },
            retry: "restart",
          },
        }),
        engine: {
          kind: "failed",
          attempts: 3,
          lastExit: { code: 1, signal: null, at: "2026-11-12T05:10:00.000Z" },
        },
        remote: null,
      }),
    );
    expect(slotText(html, "hero-state")).toBe(t("desktop.connection.hero.state.disconnected"));
    expect(html).toContain('data-slot="hero-failure"');
    expect(html).toContain(t("desktop.connection.hero.failed", { name: "dev-box" }));
    expect(buttonOf(html, t("desktop.connection.retry"))).not.toContain(DISABLED);
    expect(html).toContain('data-slot="hero-offline"');
    expect(html).toContain(t("desktop.status.serviceLost"));
  });

  test("loading: no state word, skeleton values", () => {
    const html = render(contextOf([], { state: localState({ status: { kind: "loading" } }) }));
    expect(html).not.toContain('data-slot="hero-state"');
    expect(html).not.toContain('data-slot="hero-summary"');
    expect(html).toContain('data-slot="skeleton"');
  });

  test("target notice sits above the card and is dismissible", () => {
    const html = render(contextOf([]), {
      reconnect: [],
      targetNotice: { kind: "fellBack", name: "dev-box" },
    });
    const notice = html.indexOf(t("desktop.connection.lastTarget.fellBack", { name: "dev-box" }));
    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(html.indexOf('data-slot="setting-card"'));
    expect(html).toContain(`aria-label="${t("desktop.connection.dismiss")}"`);
  });

  test("web shell hides the back button", () => {
    const html = render(
      contextOf([], {
        state: localState({ engineTarget: { kind: "remote", entry: DEV_BOX } }),
        remote: null,
        web: true,
      }),
    );
    expect(buttonOf(html, t("desktop.connection.hero.backToLocal"))).toBeNull();
  });
});
