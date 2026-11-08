import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import type { NotifyStatus } from "../../src/views/os-notify.ts";
import type { NotifyPrefs } from "../../src/views/os-notify-model.ts";
import { DesktopShellContext, type DesktopShell } from "../../src/views/desktop-shell-context.ts";
import {
  NotifyPanel,
  NotifyPanelView,
} from "../../src/views/pages/settings/settings-notify-view.tsx";

// 설정의 OS 알림 묶음(B-10). 스위치의 켜짐과 경고 줄을 HTML로 본다. 문맥이 없으면(웹) 패널은 아무것도 그리지 않는다.

const PREFS: NotifyPrefs = { turnDone: true, approval: false, scheduleFailed: true };
const HEALTHY: NotifyStatus = { permission: "granted", lastDeliveryFailed: false };

const LABEL = {
  turnDone: t("desktop.notifySettings.turnDone"),
  approval: t("desktop.notifySettings.approval"),
  scheduleFailed: t("desktop.notifySettings.scheduleFailed"),
};

function viewOf(prefs: NotifyPrefs, status: NotifyStatus): string {
  return renderToString(<NotifyPanelView prefs={prefs} status={status} onChange={() => {}} />);
}

/** 라벨 `label`을 가진 스위치 태그의 `aria-checked`. 태그를 못 찾으면 `null`이다 */
function checkedOf(html: string, label: string): string | null {
  const at = html.indexOf(`aria-label="${label}"`);
  if (at < 0) return null;
  const tag = html.slice(html.lastIndexOf("<", at), html.indexOf(">", at));
  return tag.match(/aria-checked="(true|false)"/)?.[1] ?? null;
}

describe("notification switches", () => {
  test("each switch shows the saved value of its category", () => {
    const html = viewOf(PREFS, HEALTHY);
    expect(checkedOf(html, LABEL.turnDone)).toBe("true");
    expect(checkedOf(html, LABEL.approval)).toBe("false");
    expect(checkedOf(html, LABEL.scheduleFailed)).toBe("true");
  });

  test("the focus-only sentence is always shown", () => {
    expect(viewOf(PREFS, HEALTHY)).toContain(t("desktop.notifySettings.focusOnly"));
  });
});

describe("the warning line", () => {
  test("a healthy permission shows no warning", () => {
    const html = viewOf(PREFS, HEALTHY);
    expect(html).toContain('data-notify-state="ok"');
    expect(html).not.toContain(t("desktop.notifySettings.state.failed"));
    expect(html).not.toContain(t("desktop.notifySettings.state.denied"));
  });

  test("a failed last delivery shows the warning sentence", () => {
    const html = viewOf(PREFS, { permission: "granted", lastDeliveryFailed: true });
    expect(html).toContain('data-notify-state="failed"');
    expect(html).toContain(t("desktop.notifySettings.state.failed"));
  });

  test("a denied permission shows the denied sentence", () => {
    const html = viewOf(PREFS, { permission: "denied", lastDeliveryFailed: false });
    expect(html).toContain('data-notify-state="denied"');
    expect(html).toContain(t("desktop.notifySettings.state.denied"));
  });

  test("an unasked permission shows its word, without the warning", () => {
    const html = viewOf(PREFS, { permission: "prompt", lastDeliveryFailed: false });
    expect(html).toContain(t("desktop.notifySettings.state.prompt"));
    expect(html).not.toContain(t("desktop.notifySettings.state.failed"));
  });
});

describe("NotifyPanel context", () => {
  test("without the desktop shell (web) the panel draws nothing", () => {
    expect(renderToString(<NotifyPanel />)).toBe("");
  });

  test("with the desktop shell the panel reads the saved values and the status", () => {
    const shell: DesktopShell = {
      invoke: () => Promise.resolve(null),
      subscribeIntent: () => Promise.resolve(() => {}),
      notifier: {
        status: {
          get: () => ({ permission: "granted", lastDeliveryFailed: true }),
          subscribe: () => () => {},
        },
        listen: () => () => {},
      },
      prefs: { get: () => PREFS, set: () => Promise.resolve(true) },
      appearance: {
        get: () => ({ motion: "system", zoom: 100, transcriptDetail: "full" }),
        setMotion: () => Promise.resolve(true),
        setZoom: () => Promise.resolve(true),
        setTranscriptDetail: () => Promise.resolve(true),
      },
    };
    const html = renderToString(
      <DesktopShellContext value={shell}>
        <NotifyPanel />
      </DesktopShellContext>,
    );
    expect(checkedOf(html, LABEL.approval)).toBe("false");
    expect(checkedOf(html, LABEL.turnDone)).toBe("true");
    expect(html).toContain(t("desktop.notifySettings.state.failed"));
  });
});

describe("notification card", () => {
  test("the switches sit in one setting card under the section title", () => {
    const html = viewOf(PREFS, HEALTHY);
    expect(html).toContain('data-slot="settings-notify"');
    expect(html).toContain("rounded-2xl");
    expect(html).toContain(`>${t("desktop.notifySettings.label")}<`);
  });
});
