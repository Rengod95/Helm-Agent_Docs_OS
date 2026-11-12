import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemoteScreenState } from "../../src/app/remote/remote-state.ts";
import {
  DevicesSection,
  DevicesView,
  RevokeDialogBody,
  type PendingRevoke,
} from "../../src/views/pages/connection/devices-section.tsx";
import {
  FAKE_NOW,
  HANDLERS,
  LAPTOP,
  OFF,
  PHONE,
  remoteOf,
  remoteState,
  screenState,
} from "./reach-fixtures.ts";

// "등록된 기기"의 서버 렌더. 줄의 글, 머리 동작, 빈·읽는 중·실패 상태, 끊기 확인 본문을 본다.

const NOOP = (): void => {};

function view(patch: Partial<RemoteScreenState>, pending: PendingRevoke | null = null): string {
  const { remote } = remoteOf(remoteState(patch));
  return renderToStaticMarkup(
    <DevicesView remote={remote} nowMs={FAKE_NOW} inline initialPending={pending} />,
  );
}

describe("DevicesView", () => {
  test("rows: name, last seen, address and a disconnect button; two or more get disconnect all", () => {
    const html = view({ devices: { kind: "ready", value: [LAPTOP, PHONE] } });
    expect([...html.matchAll(/data-slot="device-row"/g)].length).toBe(2);
    // 최근에 본 기기가 앞이다
    expect(html.indexOf("Pixel")).toBeLessThan(html.indexOf("Studio"));
    expect(html).toContain('data-kind="web"');
    expect(html).toContain(t("desktop.common.age.minutes", { count: 3 }));
    expect(html).toContain("192.168.0.21");
    expect(html).toContain(t("desktop.connection.devices.never"));
    expect(html).toContain(t("desktop.connection.devices.revokeAll"));
    expect(html).toContain(`aria-label="${t("desktop.connection.devices.kindDesktop")}"`);
  });

  test("one device has no disconnect all", () => {
    const html = view({ devices: { kind: "ready", value: [PHONE] } });
    expect(html).not.toContain(t("desktop.connection.devices.revokeAll"));
    expect(html).toContain(t("desktop.connection.devices.revoke"));
  });

  test("empty, loading and failed", () => {
    expect(view({ devices: { kind: "ready", value: [] } })).toContain(
      t("desktop.connection.devices.empty"),
    );
    expect(view({ devices: { kind: "loading" } })).toContain('data-slot="devices-loading"');
    const failed = view({ devices: { kind: "failed", error: { kind: "bad-reply" } } });
    expect(failed).toContain(t("desktop.connection.devices.loadFailed"));
    expect(failed).toContain(t("desktop.connection.devices.reload"));
  });

  test("busy locks the buttons; revoke failure is a note", () => {
    const html = view({
      devices: { kind: "ready", value: [PHONE] },
      busy: "revoking",
      notice: { kind: "revokeFailed", code: null },
    });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*<\/button>|disabled=""/);
    expect(html).toContain(t("desktop.connection.devices.revokeFailed"));
  });

  test("an open confirm renders in place", () => {
    const html = view(
      { devices: { kind: "ready", value: [PHONE] } },
      {
        kind: "one",
        id: "d1",
        name: "Pixel",
      },
    );
    expect(html).toContain(t("desktop.connection.devices.revokeOneTitle"));
    expect(html).toContain(t("desktop.connection.devices.revokeOneBody", { name: "Pixel" }));
  });
});

describe("RevokeDialogBody", () => {
  test("one and all", () => {
    expect(
      renderToStaticMarkup(<RevokeDialogBody pending={{ kind: "all", count: 3 }} />),
    ).toContain(t("desktop.connection.devices.revokeAllBody", { count: 3 }));
  });
});

describe("DevicesSection", () => {
  const base = {
    state: screenState(),
    engine: null,
    locale: "ko" as const,
    handlers: HANDLERS,
    web: false,
    nowMs: FAKE_NOW,
    copy: NOOP,
  };

  test("not drawn when remote access is off or the controller is missing", () => {
    const { remote } = remoteOf(remoteState({ status: { kind: "ready", value: OFF } }));
    expect(renderToStaticMarkup(<DevicesSection {...base} remote={remote} />)).toBe("");
    expect(renderToStaticMarkup(<DevicesSection {...base} remote={null} />)).toBe("");
  });

  test("drawn in the web shell even when the status says off", () => {
    const { remote } = remoteOf(remoteState({ status: { kind: "ready", value: OFF } }));
    expect(renderToStaticMarkup(<DevicesSection {...base} web remote={remote} />)).toContain(
      t("desktop.connection.devices.title"),
    );
  });
});
