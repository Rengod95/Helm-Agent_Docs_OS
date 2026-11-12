import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import type { SectionContext } from "../../src/views/pages/connection/connection-sections.ts";
import { timeTextOf } from "../../src/views/pages/connection/connection-text.ts";
import {
  failureTextsOf,
  KeepOnSection,
} from "../../src/views/pages/connection/keep-on-section.tsx";
import {
  AUTOSTART_OFF,
  contextOf,
  DEV_BOX,
  localState,
  remoteOf,
  RUNNING_SERVICE,
  SERVICE_STARTED_MS,
  STOPPED_SERVICE,
} from "./hero-fixtures.ts";

// "이 컴퓨터를 계속 켜 두기"(시안 dzRW §4)를 서버 렌더로 그려 상태별 줄·글·disabled를 값으로 본다. 대화 상자는 `inline`으로 제자리에 그린다.

/** 잠긴 단추·스위치의 속성(class의 `disabled:` 변형과 구분한다) */
const DISABLED = 'disabled=""';

function render(context: SectionContext): string {
  return renderToStaticMarkup(<KeepOnSection {...context} inline />);
}

/** 이름표로 찾은 스위치 여는 태그 */
function switchOf(html: string, label: string): string | null {
  return (
    new RegExp(`<button[^>]*role="switch"[^>]*aria-label="${label}"[^>]*>`).exec(html)?.[0] ??
    new RegExp(`<button[^>]*aria-label="${label}"[^>]*role="switch"[^>]*>`).exec(html)?.[0] ??
    null
  );
}

function buttonOf(html: string, label: string): string | null {
  const match = new RegExp(`<button[^>]*>(?:(?!</?button)[\\s\\S])*?${label}`).exec(html);
  return match === null ? null : match[0];
}

const RUN = t("desktop.connection.keepOn.run.label");
const AUTOSTART = t("desktop.connection.keepOn.autostart.label");

describe("failureTextsOf", () => {
  test("known codes pick their texts, unknown codes the general one", () => {
    expect(failureTextsOf("ensure_failed").cause).toBe(
      "desktop.connection.keepOn.failure.ensureFailed.cause",
    );
    expect(failureTextsOf("weird").fix).toBe("desktop.connection.keepOn.failure.unknown.fix");
  });
});

describe("KeepOnSection", () => {
  test("local running: switch on, status line, autostart row, restart and stop", () => {
    const html = render(contextOf([]));
    expect(html).toContain(t("desktop.connection.keepOn.title"));
    const run = switchOf(html, RUN);
    expect(run).toContain('aria-checked="true"');
    expect(run).not.toContain(DISABLED);
    expect(html).toContain(
      t("desktop.connection.keepOn.run.on", {
        time: timeTextOf(new Date(SERVICE_STARTED_MS).toISOString(), "ko"),
        count: 2,
      }),
    );
    expect(switchOf(html, AUTOSTART)).toContain('aria-checked="false"');
    expect(html).toContain(t("desktop.connection.keepOn.service.label"));
    expect(buttonOf(html, t("desktop.connection.keepOn.service.restart"))).not.toContain(DISABLED);
    expect(buttonOf(html, t("desktop.connection.keepOn.service.stop"))).not.toContain(DISABLED);
  });

  test("in the app: switch off, off line, no autostart row, engine restart only", () => {
    const html = render(contextOf([], { state: localState({ service: STOPPED_SERVICE }) }));
    expect(switchOf(html, RUN)).toContain('aria-checked="false"');
    expect(html).toContain(t("desktop.connection.keepOn.run.off"));
    expect(switchOf(html, AUTOSTART)).toBeNull();
    expect(html).toContain(t("desktop.connection.keepOn.engine.label"));
    expect(buttonOf(html, t("desktop.connection.keepOn.service.stop"))).toBeNull();
  });

  test("start failure: danger note with cause, fix, retry and details", () => {
    const html = render(
      contextOf([], {
        state: localState({
          service: {
            kind: "stopped",
            reason: "no_registration",
            startFailure: { code: "ensure_failed", detail: "exit 3" },
          },
        }),
      }),
    );
    expect(html).toContain('data-slot="keep-on-start-failure"');
    expect(html).toContain(t("desktop.connection.keepOn.failure.ensureFailed.cause"));
    expect(html).toContain(t("desktop.connection.keepOn.failure.ensureFailed.fix"));
    expect(buttonOf(html, t("desktop.connection.retry"))).not.toBeNull();
    expect(html).toContain("exit 3");
  });

  test("busy controller locks the switch; stop locked while a connect is pending", () => {
    const busy = render(contextOf([], { remote: remoteOf([], { busy: "autostart" }) }));
    expect(switchOf(busy, RUN)).toContain(DISABLED);
    const pending = render(
      contextOf([], {
        state: localState({
          pending: {
            target: { kind: "local" },
            prior: { kind: "local" },
            stage: "starting",
            attempt: 0,
            from: { engine: "running", link: "live" },
            moved: true,
          },
        }),
      }),
    );
    expect(buttonOf(pending, t("desktop.connection.keepOn.service.stop"))).toContain(DISABLED);
  });

  test("autostart unsupported: locked switch and reason", () => {
    const html = render(
      contextOf([], {
        remote: remoteOf([], {
          autostart: { kind: "ready", value: { ...AUTOSTART_OFF, supported: false } },
        }),
      }),
    );
    expect(switchOf(html, AUTOSTART)).toContain(DISABLED);
    expect(html).toContain(t("desktop.connection.keepOn.autostart.unsupported"));
  });

  test("linger advice shows a warning and the command line", () => {
    const html = render(contextOf([], { remote: remoteOf([], { autostartLinger: true }) }));
    expect(html).toContain('data-slot="keep-on-linger"');
    expect(html).toContain("loginctl enable-linger $USER");
  });

  test("autostart confirm dialog renders inline when open", () => {
    const html = render(contextOf([], { remote: remoteOf([], { autostartConfirmOpen: true }) }));
    expect(html).toContain(t("desktop.connection.keepOn.autostart.confirm.title"));
    expect(html).toContain(t("desktop.connection.keepOn.autostart.confirm.enable"));
  });

  test("restart needed note sits above the rows", () => {
    const html = render(contextOf([], { state: localState({ restartNeeded: true }) }));
    expect(html).toContain('data-slot="keep-on-restart-needed"');
    expect(html.indexOf("keep-on-restart-needed")).toBeLessThan(html.indexOf("keep-on-run"));
  });

  test("service failed notice under row 1 when there is no start failure", () => {
    const html = render(
      contextOf([], {
        state: localState({ service: STOPPED_SERVICE }),
        remote: remoteOf([], { notice: { kind: "serviceFailed", code: null } }),
      }),
    );
    expect(html).toContain(t("desktop.connection.keepOn.notice.startFailed"));
  });

  test("remote target: one line, no switch", () => {
    const html = render(
      contextOf([], {
        state: localState({ engineTarget: { kind: "remote", entry: DEV_BOX } }),
        remote: null,
      }),
    );
    expect(html).toContain(t("desktop.connection.keepOn.remoteTarget"));
    expect(html).not.toContain('role="switch"');
  });

  test("web: status line without switches or service buttons", () => {
    const html = render(contextOf([], { web: true }));
    expect(html).toContain(t("desktop.connection.keepOn.web"));
    expect(html).not.toContain('role="switch"');
    expect(buttonOf(html, t("desktop.connection.keepOn.service.restart"))).toBeNull();
    expect(html).toContain('data-slot="keep-on-status"');
  });

  test("loading: switch skeleton in place of the switch", () => {
    const html = render(
      contextOf([], { state: localState({ status: { kind: "loading" } }), remote: null }),
    );
    expect(html).not.toContain('role="switch"');
    expect(html).toContain('data-slot="skeleton"');
    expect(html).toContain(RUN);
  });

  test("running service without autostart read yet shows a switch skeleton in row 2", () => {
    const html = render(
      contextOf([], { remote: remoteOf([], { autostart: { kind: "loading" } }) }),
    );
    expect(switchOf(html, AUTOSTART)).toBeNull();
    expect(html).toContain(AUTOSTART);
    expect(RUNNING_SERVICE.kind).toBe("running");
  });
});
