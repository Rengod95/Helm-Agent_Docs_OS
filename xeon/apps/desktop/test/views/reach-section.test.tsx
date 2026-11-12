import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemoteScreenState } from "../../src/app/remote/remote-state.ts";
import type { RemoteStatus } from "../../src/app/remote/remote-types.ts";
import {
  INITIAL_REACH_SETUP,
  type ReachMode,
  type ReachSetupState,
} from "../../src/views/pages/connection/reach-model.ts";
import { PairPanel } from "../../src/views/pages/connection/reach-pair-panel.tsx";
import {
  EnableDialogBody,
  ReachSection,
  ReachView,
  ServeConfirmBody,
} from "../../src/views/pages/connection/reach-section.tsx";
import {
  FAKE_NOW,
  HANDLERS,
  OFF,
  preflightOf,
  remoteOf,
  remoteState,
  RUNNING,
  screenState,
  setupActionsOf,
  TAILSCALE_READY,
  type Call,
} from "./reach-fixtures.ts";

// "휴대폰·브라우저에서 쓰기"의 서버 렌더. 상태별로 보이는 글, data-slot, disabled 값을 본다.

const NOOP = (): void => {};

function render(
  options: {
    readonly remote?: Partial<RemoteScreenState>;
    readonly setup?: Partial<ReachSetupState>;
    readonly mode?: ReachMode;
    readonly web?: boolean;
    readonly allow?: boolean | null;
  } = {},
): { readonly html: string; readonly calls: Call[] } {
  const { remote, calls } = remoteOf(remoteState(options.remote));
  const html = renderToStaticMarkup(
    <ReachView
      state={screenState(options.allow === undefined ? true : options.allow)}
      engine={null}
      locale="ko"
      handlers={HANDLERS}
      remote={remote}
      web={options.web ?? false}
      nowMs={FAKE_NOW}
      copy={NOOP}
      setup={{ ...INITIAL_REACH_SETUP, ...options.setup }}
      setupActions={setupActionsOf(calls)}
      inline
      {...(options.mode === undefined ? {} : { initialMode: options.mode })}
    />,
  );
  return { html, calls };
}

function statusOf(status: RemoteStatus): Partial<RemoteScreenState> {
  return { status: { kind: "ready", value: status } };
}

/** 스위치 하나(role=switch)의 속성 글 */
function switchesOf(html: string): readonly string[] {
  return [...html.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map((match) => match[0]);
}

describe("ReachSection", () => {
  test("without this computer's controller it is one line", () => {
    const html = renderToStaticMarkup(
      <ReachSection
        state={screenState()}
        engine={null}
        locale="ko"
        handlers={HANDLERS}
        remote={null}
        web={false}
        nowMs={0}
        copy={NOOP}
      />,
    );
    expect(html).toContain(t("desktop.connection.reach.title"));
    expect(html).toContain(t("desktop.connection.reach.elsewhere"));
    expect(html).not.toContain('role="switch"');
  });
});

describe("enable row", () => {
  test("off: switch unchecked with the one-line hint and nothing else", () => {
    const { html } = render({ remote: statusOf(OFF) });
    expect(html).toContain(t("desktop.connection.reach.enable.offHint"));
    const switches = switchesOf(html);
    expect(switches.length).toBe(1);
    expect(switches[0]).toContain('aria-checked="false"');
    expect(html).not.toContain(t("desktop.connection.reach.mode.label"));
    expect(html).not.toContain(t("desktop.connection.reach.respond.label"));
  });

  test("loading shows a skeleton instead of the switch", () => {
    const { html } = render({ remote: { status: { kind: "loading" } } });
    expect(html).toContain('data-slot="reach-enable"');
    expect(switchesOf(html).length).toBe(0);
  });

  test("read failure is a danger note with reload", () => {
    const { html } = render({
      remote: { status: { kind: "failed", error: { kind: "failed", message: null } } },
    });
    expect(html).toContain(t("desktop.connection.reach.enable.loadFailed"));
    expect(html).toContain(t("desktop.connection.reach.reload"));
  });

  test("web hides the switch with the reason", () => {
    const { html } = render({ web: true });
    expect(html).toContain(t("desktop.connection.reach.enable.web"));
    expect(html).not.toContain(t("desktop.connection.reach.mode.label"));
    expect(html).toContain('data-slot="reach-web-panel"');
  });

  test("failed start shows the error and retry", () => {
    const { html } = render({
      remote: statusOf({
        ...RUNNING,
        state: "failed",
        error: { kind: "bind", message: "port busy" },
      }),
    });
    expect(html).toContain(t("desktop.connection.reach.enable.failed", { message: "port busy" }));
    expect(html).toContain(t("desktop.connection.retry"));
  });

  test("busy locks the switch", () => {
    const { html } = render({ remote: { busy: "enabling" } });
    expect(switchesOf(html)[0]).toContain("disabled");
  });
});

describe("modes", () => {
  test("default is wifi: four check lines, pair panel and certificate note", () => {
    const { html } = render({ setup: { preflight: { kind: "ready", value: preflightOf() } } });
    expect(html).toContain(t("desktop.connection.reach.mode.label"));
    expect([...html.matchAll(/data-slot="check-step"/g)].length).toBe(4);
    expect(html).toContain(t("desktop.connection.reach.check.port"));
    expect(html).toContain('data-slot="reach-pair-panel"');
    expect(html).toContain('data-slot="reach-wifi-note"');
    expect(html).toContain(t("desktop.connection.reach.respond.label"));
  });

  test("a failed line has its auto fix button", () => {
    const { html } = render({
      setup: {
        preflight: {
          kind: "ready",
          value: preflightOf({
            allowed_hosts: {
              status: "fail",
              cause: "no_hosts",
              fix: "set_allowed_hosts",
              autoFix: "add_allowed_hosts",
            },
          }),
        },
      },
    });
    expect(html).toContain(t("desktop.connection.reach.cause.noHosts"));
    expect(html).toContain(t("desktop.connection.reach.autoFix.addHosts"));
  });

  test("tailscale ready shows the name and the serve switch", () => {
    const { html } = render({
      mode: "tailscale",
      setup: { tailscale: { kind: "ready", value: TAILSCALE_READY } },
    });
    expect(html).toContain('data-slot="reach-tailscale"');
    expect(html).toContain("my-mac.tail1234.ts.net");
    expect(html).toContain(t("desktop.connection.reach.serve.label"));
    expect(html).not.toContain('data-slot="reach-wifi-note"');
  });

  test("tailscale consent failure offers the consent page", () => {
    const { html } = render({
      mode: "tailscale",
      setup: {
        tailscale: {
          kind: "ready",
          value: {
            ...TAILSCALE_READY,
            failure: "https_not_enabled",
            consentUrl: "https://login.tailscale.com/f/serve",
          },
        },
      },
    });
    expect(html).toContain(t("desktop.connection.reach.serveFailure.httpsNotEnabled"));
    expect(html).toContain(t("desktop.connection.reach.serve.openConsent"));
  });

  test("tailscale not installed offers the download", () => {
    const { html } = render({
      mode: "tailscale",
      setup: {
        tailscale: { kind: "ready", value: { ...TAILSCALE_READY, state: "not_installed" } },
      },
    });
    expect(html).toContain(t("desktop.connection.reach.tailscale.download"));
    expect(html).not.toContain(t("desktop.connection.reach.serve.label"));
  });

  test("public without a domain asks for one", () => {
    const { html } = render({ mode: "public" });
    expect(html).toContain('data-slot="reach-domain"');
    expect(html).toContain(t("desktop.connection.reach.proxy.needDomain"));
    expect(html).toContain(t("desktop.connection.reach.public.check"));
    expect(html).toContain(t("desktop.connection.reach.pair.noAddress"));
  });

  test("public with an allowed domain picks public by default and shows the proxy text", () => {
    const { html } = render({
      remote: statusOf({ ...RUNNING, hosts: ["fresnel.example.com"] }),
      setup: {
        proxy: {
          kind: "ready",
          value: {
            text: "fresnel.example.com {\n  reverse_proxy 127.0.0.1:47443\n}",
            plan: {
              listen: "127.0.0.1:47100",
              listenTls: "127.0.0.1:47443",
              hosts: ["fresnel.example.com"],
            },
          },
        },
      },
    });
    expect(html).toContain('value="fresnel.example.com"');
    expect(html).toContain('data-slot="reach-proxy-code"');
    expect(html).toContain("reverse_proxy 127.0.0.1:47443");
    expect(html).toContain("https://fresnel.example.com");
    expect(html).toContain(t("desktop.connection.reach.scope.internet"));
  });

  test("respond row is locked with a reason when the value is unknown", () => {
    const { html } = render({ allow: null });
    expect(html).toContain(t("desktop.connection.reach.respond.unknown"));
    const respond = switchesOf(html)[1] ?? "";
    expect(respond).toContain("disabled");
  });
});

describe("enable dialog", () => {
  test("body lists the https addresses and the risk", () => {
    const html = renderToStaticMarkup(<EnableDialogBody status={RUNNING} />);
    expect(html).toContain("https://192.168.0.10:47443");
    expect(html).toContain("https://my-mac.local:47443");
    expect(html).not.toContain("http://127.0.0.1");
    expect(html).toContain(t("desktop.connection.reach.confirm.risk"));
  });

  test("off status has no addresses yet", () => {
    const html = renderToStaticMarkup(<EnableDialogBody status={OFF} />);
    expect(html).toContain(t("desktop.connection.reach.confirm.noAddress"));
  });

  test("open dialog renders in place", () => {
    const { html } = render({ remote: { ...statusOf(OFF), confirmOpen: true } });
    expect(html).toContain(t("desktop.connection.reach.confirm.title"));
    expect(html).toContain(t("desktop.connection.reach.confirm.enable"));
  });

  test("serve confirm shows the command and the public log line", () => {
    const html = renderToStaticMarkup(
      <ServeConfirmBody
        command="tailscale serve --bg --https=443 https+insecure://127.0.0.1:47443"
        copy={NOOP}
      />,
    );
    expect(html).toContain("https+insecure://127.0.0.1:47443");
    expect(html).toContain(t("desktop.connection.reach.serve.publicLog"));
  });
});

describe("PairPanel", () => {
  const address = {
    base: "https://192.168.0.10:47443",
    link: "https://192.168.0.10:47443/login#code=ABCDE12345",
    scope: "wifi" as const,
  };

  test("no code: dashed box with the connect button", () => {
    const html = renderToStaticMarkup(
      <PairPanel
        addresses={[{ ...address, link: null }]}
        pairing={{ kind: "none" }}
        nowMs={FAKE_NOW}
        busy={false}
        fingerprint={null}
        onIssue={NOOP}
        copy={NOOP}
      />,
    );
    expect(html).toContain('data-slot="reach-qr-empty"');
    expect(html).toContain(t("desktop.connection.reach.pair.issue"));
    expect(html).toContain(t("desktop.connection.reach.scope.wifi"));
    expect(html).not.toContain('role="img"');
  });

  test("issued code: QR, hyphenated code and remaining time", () => {
    const html = renderToStaticMarkup(
      <PairPanel
        addresses={[address]}
        pairing={{ kind: "issued", code: { code: "ABCDE12345", expiresAt: FAKE_NOW + 272_000 } }}
        nowMs={FAKE_NOW}
        busy={false}
        fingerprint="AB:12:CD:34"
        onIssue={NOOP}
        copy={NOOP}
      />,
    );
    expect(html).toContain('data-expired="false"');
    expect(html).toContain('role="img"');
    expect(html).toContain("ABCDE-12345");
    expect(html).toContain(t("desktop.connection.reach.pair.remaining", { time: "4:32" }));
    expect(html).toContain(t("desktop.connection.reach.pair.trustLabel"));
    expect(html).toContain("AB12 CD34 …");
  });

  test("expired code dims the QR", () => {
    const html = renderToStaticMarkup(
      <PairPanel
        addresses={[address]}
        pairing={{ kind: "issued", code: { code: "ABCDE12345", expiresAt: FAKE_NOW - 1 } }}
        nowMs={FAKE_NOW}
        busy={false}
        fingerprint={null}
        onIssue={NOOP}
        copy={NOOP}
      />,
    );
    expect(html).toContain('data-expired="true"');
    expect(html).toContain("opacity-20");
    expect(html).toContain(t("desktop.connection.reach.pair.expired"));
    expect(html).toContain(t("desktop.connection.reach.pair.newCode"));
  });

  test("several addresses use a select", () => {
    const html = renderToStaticMarkup(
      <PairPanel
        addresses={[address, { ...address, base: "https://my-mac.local:47443" }]}
        pairing={{ kind: "none" }}
        nowMs={FAKE_NOW}
        busy={false}
        fingerprint={null}
        onIssue={NOOP}
        copy={NOOP}
      />,
    );
    expect(html).toContain(`aria-label="${t("desktop.connection.reach.pair.addressLabel")}"`);
  });
});
