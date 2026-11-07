import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { t } from "@fresnel/client/i18n";
import type { EngineTarget, RestoreReport } from "../../src/transport/ipc.ts";
import type { RestoreRefusal, RestoreRefusalKind } from "../../src/views/commands.ts";
import { BACKUP_NOTE_IDS } from "../../src/views/pages/settings/settings-backup-model.ts";
import type {
  RestorePhase,
  RestoreState,
} from "../../src/views/pages/settings/settings-restore-model.ts";
import {
  RestoreView,
  type RestoreHandlers,
} from "../../src/views/pages/settings/settings-restore-view.tsx";
import { RESTORE_REPORT } from "../transport/fake-ipc.ts";

// 데이터 복원 구역(P-09 고급 탭)의 서버 렌더. 대기, 진행, 되돌림, 거절 종류마다, 원격과 모름의 막힘을 그린다.
// 클릭과 확인은 DOM이 없어 `settings-restore-model.test.ts`가 입구로 본다. 문장은 `t()`로 비교한다.

const NOOP = (): void => {};
const handlers: RestoreHandlers = { edit: NOOP, ask: NOOP, cancel: NOOP, confirm: NOOP };
const LOCAL: EngineTarget = { kind: "local" };
const REMOTE: EngineTarget = { kind: "remote", address: "10.0.0.2:7000" };
const FOLDER = "/backups/export-1";

function stateOf(over: Partial<RestoreState> = {}): RestoreState {
  return { path: FOLDER, target: LOCAL, asking: false, phase: { kind: "idle" }, ...over };
}

function html(
  state: RestoreState,
  extra: { readonly onPick?: () => void; readonly pickError?: string | null } = {},
): string {
  return renderToString(<RestoreView state={state} handlers={handlers} {...extra} />);
}

/** 버튼이 막혔는지. 막힌 단추와 잠긴 입력창은 `disabled` 속성을 단다 */
function buttonDisabled(out: string): boolean {
  return out.includes('disabled=""');
}

describe("restore section states", () => {
  test("idle with a folder and a local engine: the button is enabled and no reason line shows", () => {
    const out = html(stateOf());
    expect(out).toContain(t("desktop.settings.restore.button"));
    expect(out).toContain(FOLDER);
    expect(buttonDisabled(out)).toBe(false);
    expect(out).not.toContain(t("desktop.settings.restore.blocked.remote"));
  });

  test("a blank folder keeps the button disabled without a reason line", () => {
    const out = html(stateOf({ path: "  " }));
    expect(buttonDisabled(out)).toBe(true);
    expect(out).not.toContain(t("desktop.settings.restore.blocked.remote"));
  });

  test("running: the button and the folder are disabled and the progress line shows", () => {
    const out = html(stateOf({ phase: { kind: "running" } }));
    expect(out).toContain(t("desktop.settings.restore.running"));
    expect(buttonDisabled(out)).toBe(true);
  });

  test("the folder button shows only when a picker is given, and the typed field stays", () => {
    const without = html(stateOf());
    expect(without).not.toContain(t("desktop.workspace.pickFolderButton"));
    expect(without).toContain(t("desktop.settings.restore.path.label"));
    const withPick = html(stateOf(), { onPick: NOOP });
    expect(withPick).toContain(t("desktop.workspace.pickFolderButton"));
    expect(withPick).toContain(t("desktop.settings.restore.path.label"));
    expect(withPick).toContain(t("desktop.settings.restore.path.hint"));
  });

  test("the folder button is disabled while a restore runs", () => {
    const out = html(stateOf({ phase: { kind: "running" } }), { onPick: NOOP });
    expect(out.split('disabled=""').length - 1).toBeGreaterThanOrEqual(3);
  });

  test("a relative path shows the reason line and keeps the button disabled", () => {
    const out = html(stateOf({ path: "backups/export-1" }));
    expect(out).toContain(t("desktop.settings.restore.blocked.relative"));
    expect(buttonDisabled(out)).toBe(true);
    expect(html(stateOf())).not.toContain(t("desktop.settings.restore.blocked.relative"));
  });

  test("a failed picker shows its line", () => {
    const out = html(stateOf(), { onPick: NOOP, pickError: t("desktop.workspace.pickFailed") });
    expect(out).toContain(t("desktop.workspace.pickFailed"));
  });

  test("the info tip carries the included, excluded and age key notes shared with the backup block", () => {
    const out = html(stateOf());
    for (const id of BACKUP_NOTE_IDS) expect(out).toContain(t(id));
  });
});

function restoredOf(report: RestoreReport): RestorePhase {
  return { kind: "restored", report };
}

describe("restored shows the result block", () => {
  test("the blobs added, the missing blobs, the previous folder, and the key reminder show", () => {
    const out = html(stateOf({ phase: restoredOf(RESTORE_REPORT) }));
    expect(out).toContain(t("desktop.settings.restore.done.blobs", { count: 2 }));
    expect(out).toContain(t("desktop.settings.restore.done.missing", { count: 1 }));
    expect(out).toContain(
      t("desktop.settings.restore.done.previous", { path: RESTORE_REPORT.previousDir ?? "" }),
    );
    expect(out).toContain(t("desktop.settings.restore.done.keyNotice"));
  });

  test("a recovered direction is named, and a report with none of the optional lines omits them", () => {
    const rolledForward = html(
      stateOf({ phase: restoredOf({ ...RESTORE_REPORT, recovered: "rolled_forward" }) }),
    );
    expect(rolledForward).toContain(t("desktop.settings.restore.done.recovered.rolledForward"));
    const clean = html(
      stateOf({
        phase: restoredOf({
          ...RESTORE_REPORT,
          missingBlobs: [],
          previousDir: null,
          recovered: null,
        }),
      }),
    );
    expect(clean).not.toContain(t("desktop.settings.restore.done.missing", { count: 0 }));
    expect(clean).not.toContain(t("desktop.settings.restore.done.recovered.rolledBack"));
    expect(clean).toContain(t("desktop.settings.restore.done.keyNotice"));
  });
});

describe("each refused kind shows its message and fix", () => {
  const kinds: readonly RestoreRefusalKind[] = [
    "not_a_backup",
    "future_version",
    "engine_running",
    "invalid",
    "io",
    "remote",
    "busy",
  ];
  for (const kind of kinds) {
    test(`${kind} shows the message and the fix`, () => {
      const refusal: RestoreRefusal = {
        kind,
        message: `message for ${kind}`,
        fix: `fix for ${kind}`,
      };
      const out = html(stateOf({ phase: { kind: "refused", refusal } }));
      expect(out).toContain(`message for ${kind}`);
      expect(out).toContain(`fix for ${kind}`);
      expect(buttonDisabled(out)).toBe(false);
    });
  }

  test("a refusal with no fix shows the message only", () => {
    const refusal: RestoreRefusal = { kind: "io", message: "only this", fix: null };
    const out = html(stateOf({ phase: { kind: "refused", refusal } }));
    expect(out).toContain("only this");
    expect(out).not.toContain('<span class="block"></span>');
  });
});

describe("a remote engine target disables the button with its reason; an unknown one does not", () => {
  test("remote: the reason line shows and the button is disabled", () => {
    const out = html(stateOf({ target: REMOTE }));
    expect(out).toContain(t("desktop.settings.restore.blocked.remote"));
    expect(buttonDisabled(out)).toBe(true);
  });

  test("unknown: the button stays enabled", () => {
    const out = html(stateOf({ target: null }));
    expect(out).not.toContain(t("desktop.settings.restore.blocked.remote"));
    expect(buttonDisabled(out)).toBe(false);
  });
});
