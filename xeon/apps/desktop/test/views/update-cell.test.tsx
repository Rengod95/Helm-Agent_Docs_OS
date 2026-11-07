import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import type { EngineMirror } from "../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore } from "../../src/state/ui/store.ts";
import { UpdateContext } from "../../src/views/update-context.ts";
import type { UpdateController } from "../../src/views/update-controller.ts";
import type { UpdateState } from "../../src/views/update-model.ts";
import { UpdateBody } from "../../src/views/update-parts.tsx";
import {
  UpdatePanel,
  UpdateLineView,
} from "../../src/views/pages/settings/settings-update-view.tsx";
import { PluginUiProvider } from "../../src/views/plugin/plugin-context.tsx";
import { Providers } from "../../src/views/providers.tsx";
import { StatusBar } from "../../src/views/status-bar.tsx";
import { fakeCommands } from "./fake-commands.ts";
import { emptyPluginUi } from "./plugin/support.tsx";
import { harness } from "../state/helpers.ts";

// 업데이트 칸과 설정 줄의 마크업(B-10). 상태마다 칸의 점과 글, Popover 본문, 설정 줄의 글과 단추를 본다.
// 문맥이 없으면(웹) 칸과 줄이 없다. Popover 본문과 대화 상자는 열 때만 그려지므로 본문은 `UpdateBody`를 직접 그린다.

const VERSION = "0.4.1";
const AVAILABLE: UpdateState = { kind: "available", version: "0.4.2", notes: "고친 점\n둘째 줄" };
const DOWNLOADING: UpdateState = {
  kind: "downloading",
  version: "0.4.2",
  notes: null,
  downloaded: 21,
  total: 100,
};
const READY: UpdateState = { kind: "ready", version: "0.4.2", notes: null };

/** 상태가 바뀌지 않는 컨트롤러. 명령은 아무 일도 하지 않는다 */
function stubOf(state: UpdateState, currentVersion: string | null = VERSION): UpdateController {
  return {
    getState: () => state,
    subscribe: () => () => {},
    currentVersion: () => currentVersion,
    start: () => Promise.resolve(),
    check: () => Promise.resolve(),
    download: () => Promise.resolve(),
    installAndRestart: () => Promise.resolve(),
    retry: () => Promise.resolve(),
  };
}

/** 상태가 바뀌지 않는 엔진 거울. 서버 렌더가 읽는 처음 상태가 곧 이 상태다 */
function frozenStore(state: EngineMirror): ReadonlyStore<EngineMirror> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

/** 상태 표시줄을 주어진 업데이트 문맥으로 그린다. 문맥이 null이면 웹과 같다 */
function barHtml(controller: UpdateController | null): string {
  const h = harness();
  h.store.flush();
  return renderToString(
    <Providers
      engine={frozenStore(h.store.read.getState())}
      ui={createUiStore().read}
      commands={fakeCommands()}
    >
      <UpdateContext value={controller}>
        <PluginUiProvider value={emptyPluginUi()}>
          <StatusBar />
        </PluginUiProvider>
      </UpdateContext>
    </Providers>,
  );
}

describe("update status bar cell", () => {
  test("without an update context (web) there is no update cell", () => {
    expect(barHtml(null)).not.toContain('data-bar-cell="update"');
  });

  test("the cell shows for an available update, with a success dot and the mockup's words", () => {
    const html = barHtml(stubOf(AVAILABLE));
    expect(html).toContain('data-bar-cell="update"');
    expect(html).toContain('data-bar-dot="success"');
    expect(html).toContain(t("desktop.update.cell.available"));
  });

  test("a download shows its percent, and an unknown total shows the words without one", () => {
    expect(barHtml(stubOf(DOWNLOADING))).toContain(
      t("desktop.update.cell.downloading", { percent: 21 }),
    );
    const unknown = barHtml(stubOf({ ...DOWNLOADING, total: null }));
    expect(unknown).toContain(t("desktop.update.cell.downloadingUnknown"));
    expect(unknown).not.toContain(t("desktop.update.cell.downloading", { percent: 21 }));
  });

  test("a ready update says to restart, and an applying one says it is applying", () => {
    expect(barHtml(stubOf(READY))).toContain(t("desktop.update.cell.ready"));
    const applying = barHtml(stubOf({ kind: "installing", version: "0.4.2", notes: null }));
    expect(applying).toContain(t("desktop.update.cell.installing"));
  });

  test("a failure is danger, and an offline download is warning", () => {
    const failed = barHtml(
      stubOf({
        kind: "failed",
        stage: "download",
        reason: "signature",
        version: "0.4.2",
        notes: null,
      }),
    );
    expect(failed).toContain('data-bar-dot="danger"');
    expect(failed).toContain(t("desktop.update.cell.failed"));
    const offline = barHtml(
      stubOf({ kind: "offline", stage: "download", version: "0.4.2", notes: null }),
    );
    expect(offline).toContain('data-bar-dot="warning"');
    expect(offline).toContain(t("desktop.update.cell.offline"));
  });

  test("the check step, the latest version and an unconfigured app show no cell", () => {
    const hidden: readonly UpdateState[] = [
      { kind: "checking" },
      { kind: "current" },
      { kind: "unconfigured" },
      { kind: "offline", stage: "check", version: null, notes: null },
    ];
    for (const state of hidden) {
      expect(barHtml(stubOf(state))).not.toContain('data-bar-cell="update"');
    }
  });
});

describe("update popover body", () => {
  const handlers = { download: () => {}, install: () => {}, retry: () => {} };

  test("an available update shows both versions, up to three note lines, and the download button", () => {
    const html = renderToString(
      <UpdateBody state={AVAILABLE} currentVersion={VERSION} handlers={handlers} />,
    );
    expect(html).toContain(VERSION);
    expect(html).toContain("0.4.2");
    expect(html).toContain("고친 점");
    expect(html).toContain("둘째 줄");
    expect(html).toContain(t("desktop.update.download.button"));
    expect(html).toContain(t("desktop.update.download.info"));
  });

  test("a download shows its progress with the percent and the signature note", () => {
    const html = renderToString(
      <UpdateBody state={DOWNLOADING} currentVersion={VERSION} handlers={handlers} />,
    );
    expect(html).toContain(t("desktop.update.popover.progressPercent", { percent: 21 }));
    expect(html).toContain('aria-valuenow="21"');
  });

  test("a download of unknown size has no percent", () => {
    const html = renderToString(
      <UpdateBody
        state={{ ...DOWNLOADING, total: null }}
        currentVersion={VERSION}
        handlers={handlers}
      />,
    );
    expect(html).toContain(t("desktop.update.popover.signatureLater"));
    expect(html).toContain('data-state="indeterminate"');
    expect(html).not.toContain("aria-valuenow");
  });

  test("a ready update offers the restart with its info beside it", () => {
    const html = renderToString(
      <UpdateBody state={READY} currentVersion={VERSION} handlers={handlers} />,
    );
    expect(html).toContain(t("desktop.update.install.button"));
    expect(html).toContain(t("desktop.restart.info"));
  });

  test("a failed install shows its reason and a retry button", () => {
    const html = renderToString(
      <UpdateBody
        state={{ kind: "failed", stage: "install", reason: "other", version: "0.4.2", notes: null }}
        currentVersion={VERSION}
        handlers={handlers}
      />,
    );
    expect(html).toContain(t("desktop.update.reason.other"));
    expect(html).toContain(t("desktop.update.retry.button"));
  });

  test("a bad signature says nothing was installed and offers no install-anyway button", () => {
    const html = renderToString(
      <UpdateBody
        state={{
          kind: "failed",
          stage: "download",
          reason: "signature",
          version: "0.4.2",
          notes: null,
        }}
        currentVersion={VERSION}
        handlers={handlers}
      />,
    );
    expect(html).toContain(t("desktop.update.reason.signature"));
    expect(html).not.toContain(t("desktop.update.install.button"));
  });

  test("offline shows the connection sentence and a retry button", () => {
    const html = renderToString(
      <UpdateBody
        state={{ kind: "offline", stage: "download", version: "0.4.2", notes: null }}
        currentVersion={VERSION}
        handlers={handlers}
      />,
    );
    expect(html).toContain(t("desktop.update.offline"));
    expect(html).toContain(t("desktop.update.retry.button"));
  });
});

const noop = (): void => {};

/** 설정 줄을 그린다. 명령은 아무 일도 하지 않는다 */
function lineOf(state: UpdateState, currentVersion: string | null = VERSION): string {
  return renderToString(
    <UpdateLineView
      state={state}
      currentVersion={currentVersion}
      onCheck={noop}
      onDownload={noop}
    />,
  );
}

describe("settings update line", () => {
  test("the line names the current version and the check button", () => {
    const html = lineOf({ kind: "current" });
    expect(html).toContain(t("desktop.update.line.version", { version: VERSION }));
    expect(html).toContain(t("desktop.update.line.current"));
    expect(html).toContain(t("desktop.update.check.button"));
  });

  test("the title is the term of a list row like the other overview rows (rtE R-6a)", () => {
    const html = lineOf({ kind: "current" });
    const term = html.match(/data-slot="list-description-term"[^>]*>([^<]*)</);
    expect(term?.[1]).toBe(t("desktop.update.line.title"));
  });

  test("the status sentence follows each state", () => {
    expect(lineOf({ kind: "checking" })).toContain(t("desktop.update.line.checking"));
    expect(lineOf(AVAILABLE)).toContain(t("desktop.update.line.available", { version: "0.4.2" }));
    expect(lineOf(DOWNLOADING)).toContain(t("desktop.update.line.downloading", { percent: 21 }));
    expect(lineOf({ ...DOWNLOADING, total: null })).toContain(
      t("desktop.update.line.downloadingUnknown"),
    );
    expect(lineOf(READY)).toContain(t("desktop.update.line.ready"));
    expect(lineOf({ kind: "installing", version: "0.4.2", notes: null })).toContain(
      t("desktop.update.line.installing"),
    );
    expect(lineOf({ kind: "offline", stage: "check", version: null, notes: null })).toContain(
      t("desktop.update.offline"),
    );
    expect(
      lineOf({ kind: "failed", stage: "check", reason: "no_release", version: null, notes: null }),
    ).toContain(t("desktop.update.reason.noRelease"));
  });

  test("the download button shows only when an update was found or a download failed", () => {
    const download = t("desktop.update.download.button");
    const retry = t("desktop.update.retry.button");
    const failedDownload: UpdateState = {
      kind: "failed",
      stage: "download",
      reason: "signature",
      version: "0.4.2",
      notes: null,
    };
    const found = lineOf(AVAILABLE);
    expect(found).toContain(`>${download}<`);
    expect(found).not.toContain(`>${retry}<`);
    const failed = lineOf(failedDownload);
    expect(failed).toContain(`>${retry}<`);
    expect(failed).not.toContain(`>${download}<`);
    for (const state of [{ kind: "current" } as const, DOWNLOADING, READY]) {
      const html = lineOf(state);
      expect(html).not.toContain(`>${download}<`);
      expect(html).not.toContain(`>${retry}<`);
    }
  });

  test("an unconfigured app shows one sentence and no button", () => {
    const html = lineOf({ kind: "unconfigured" });
    expect(html).toContain(t("desktop.update.line.unconfigured"));
    expect(html).not.toContain(t("desktop.update.check.button"));
    expect(html).not.toContain(t("desktop.update.line.version", { version: VERSION }));
  });

  test("the button is off while a download or an install runs", () => {
    expect(lineOf(DOWNLOADING)).toContain('disabled=""');
    expect(lineOf({ kind: "installing", version: "0.4.2", notes: null })).toContain('disabled=""');
    expect(lineOf({ kind: "current" })).not.toContain('disabled=""');
  });

  test("the version line is left out until the version is known", () => {
    expect(lineOf({ kind: "current" }, null)).not.toContain(
      t("desktop.update.line.version", { version: VERSION }),
    );
  });

  test("without an update context (web) the panel draws nothing", () => {
    expect(renderToString(<UpdatePanel />)).toBe("");
  });
});
