import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { t } from "@fresnel/client/i18n";
import type { BackupReport, EngineTarget } from "../../src/transport/ipc.ts";
import type { StorageFailure } from "../../src/views/commands.ts";
import {
  BACKUP_NOTE_IDS,
  type BackupPhase,
  type BackupState,
} from "../../src/views/pages/settings/settings-backup-model.ts";
import {
  BackupConfirmText,
  BackupView,
  type BackupHandlers,
} from "../../src/views/pages/settings/settings-backup-view.tsx";
import { BACKUP_REPORT } from "../transport/fake-ipc.ts";

// 백업 만들기 구역의 서버 렌더. 대기, 막힘(빈 칸, 상대 경로, 원격), 진행, 만든 결과, 거절, 확인 대화 상자를 그린다.
// 클릭과 확인은 DOM이 없어 `settings-backup-model.test.ts`가 입구로 본다. 문장은 `t()`로 비교한다.

const NOOP = (): void => {};
const handlers: BackupHandlers = { edit: NOOP, ask: NOOP, cancel: NOOP, confirm: NOOP };
const LOCAL: EngineTarget = { kind: "local" };
const REMOTE: EngineTarget = { kind: "remote", address: "10.0.0.2:7000" };
const FOLDER = "/backups";
const FIX = "공간을 비운 뒤 다시 시도해 주세요";
const FAILURE: StorageFailure = { kind: "environment", message: "디스크가 가득 찼어요", fix: FIX };

function stateOf(over: Partial<BackupState> = {}): BackupState {
  return { parent: FOLDER, target: LOCAL, asking: false, phase: { kind: "idle" }, ...over };
}

function html(
  state: BackupState,
  extra: { readonly onPick?: () => void; readonly pickError?: string | null } = {},
): string {
  return renderToString(<BackupView state={state} handlers={handlers} {...extra} />);
}

/** 버튼이 막혔는지. 막힌 단추와 잠긴 입력창은 `disabled` 속성을 단다 */
function buttonDisabled(out: string): boolean {
  return out.includes('disabled=""');
}

describe("backup section states", () => {
  test("idle with a folder and a local engine: the button is enabled and no reason line shows", () => {
    const out = html(stateOf());
    expect(out).toContain(t("desktop.settings.backup.button"));
    expect(out).toContain(FOLDER);
    expect(buttonDisabled(out)).toBe(false);
    expect(out).not.toContain(t("desktop.settings.backup.blocked.remote"));
    expect(out).not.toContain(t("desktop.settings.backup.blocked.blank"));
  });

  test("the warning about secret values is visible without any interaction", () => {
    const out = html(stateOf());
    expect(out).toContain(t("desktop.settings.backup.warn.secrets"));
  });

  test("the info tip carries the included, excluded and age key notes", () => {
    const out = html(stateOf());
    for (const id of BACKUP_NOTE_IDS) expect(out).toContain(t(id));
  });

  test("a blank folder keeps the button disabled and shows the blank reason line", () => {
    const out = html(stateOf({ parent: "   " }));
    expect(buttonDisabled(out)).toBe(true);
    expect(out).toContain(t("desktop.settings.backup.blocked.blank"));
    expect(out).not.toContain(t("desktop.settings.backup.blocked.remote"));
  });

  test("a relative folder shows the reason line and keeps the button disabled", () => {
    const out = html(stateOf({ parent: "backups" }));
    expect(out).toContain(t("desktop.settings.backup.blocked.relative"));
    expect(buttonDisabled(out)).toBe(true);
    expect(html(stateOf())).not.toContain(t("desktop.settings.backup.blocked.relative"));
  });

  test("a remote engine shows the remote reason line and disables the button", () => {
    const out = html(stateOf({ target: REMOTE }));
    expect(out).toContain(t("desktop.settings.backup.blocked.remote"));
    expect(buttonDisabled(out)).toBe(true);
  });

  test("an unknown engine target does not block the button", () => {
    const out = html(stateOf({ target: null }));
    expect(out).not.toContain(t("desktop.settings.backup.blocked.remote"));
    expect(buttonDisabled(out)).toBe(false);
  });

  test("running: the button and the folder are disabled and the progress line shows", () => {
    const out = html(stateOf({ phase: { kind: "running" } }));
    expect(out).toContain(t("desktop.settings.backup.running"));
    expect(buttonDisabled(out)).toBe(true);
  });

  test("the folder button shows only when a picker is given, and the typed field stays", () => {
    const without = html(stateOf());
    expect(without).not.toContain(t("desktop.workspace.pickFolderButton"));
    expect(without).toContain(t("desktop.settings.backup.path.label"));
    const withPick = html(stateOf(), { onPick: NOOP });
    expect(withPick).toContain(t("desktop.workspace.pickFolderButton"));
  });

  test("a failed picker shows its line", () => {
    const out = html(stateOf(), { onPick: NOOP, pickError: t("desktop.workspace.pickFailed") });
    expect(out).toContain(t("desktop.workspace.pickFailed"));
  });
});

function doneOf(report: BackupReport): BackupPhase {
  return { kind: "done", report };
}

describe("a made backup shows its result block", () => {
  test("the blob count, the made folder, and the age key notice show", () => {
    const out = html(stateOf({ phase: doneOf(BACKUP_REPORT) }));
    expect(out).toContain(t("desktop.settings.backup.done.blobs", { count: 3 }));
    expect(out).toContain(
      t("desktop.settings.backup.done.folder", { path: BACKUP_REPORT.destDir }),
    );
    expect(out).toContain(t("desktop.settings.backup.note.ageKey"));
    expect(out).not.toContain(t("desktop.settings.backup.done.missing", { count: 0 }));
  });

  test("missing blobs add their line only when there are some", () => {
    const out = html(
      stateOf({ phase: doneOf({ ...BACKUP_REPORT, missingBlobs: ["3f1a", "9c02"] }) }),
    );
    expect(out).toContain(t("desktop.settings.backup.done.missing", { count: 2 }));
  });
});

describe("a refused backup shows its message and fix", () => {
  test("the message and the fix show, and the button stays enabled", () => {
    const out = html(stateOf({ phase: { kind: "refused", failure: FAILURE } }));
    expect(out).toContain(FAILURE.message);
    expect(out).toContain(t("desktop.settings.backup.button"));
    expect(buttonDisabled(out)).toBe(false);
    expect(out).toContain(FIX);
  });
});

describe("the confirm dialog text names the folder, the secret warning, and what is not included", () => {
  test("the dialog body names the folder, keeps the warning visible, and lists what is not included", () => {
    const out = renderToString(<BackupConfirmText path={FOLDER} />);
    expect(out).toContain(t("desktop.settings.backup.confirm.folder", { path: FOLDER }));
    expect(out).toContain(t("desktop.settings.backup.warn.secrets"));
    expect(out).toContain(t("desktop.settings.backup.note.excluded"));
  });
});
