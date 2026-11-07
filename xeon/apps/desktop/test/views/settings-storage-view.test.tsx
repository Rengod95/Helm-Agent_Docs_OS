import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { t } from "@fresnel/client/i18n";
import type { StorageUsage } from "../../src/transport/ipc.ts";
import type { StorageFailure } from "../../src/views/commands.ts";
import { formatBytes } from "../../src/views/attachment-model.ts";
import {
  previousLabelOf,
  type StorageState,
} from "../../src/views/pages/settings/settings-storage-model.ts";
import {
  PreviousConfirmText,
  StorageView,
  type StorageHandlers,
} from "../../src/views/pages/settings/settings-storage-view.tsx";
import { STORAGE_USAGE } from "../transport/fake-ipc.ts";

// 저장 공간 구역의 서버 렌더. 읽는 중, 읽기 실패, 원격, 사용량과 사본 목록, 사본이 없을 때, 지우기 실패와 확인 대화 상자를 그린다.
// 클릭과 확인은 DOM이 없어 `settings-storage-model.test.ts`가 입구로 본다. 문장은 `t()`로 비교한다.

const NOOP = (): void => {};
const handlers: StorageHandlers = {
  refresh: NOOP,
  openDataDir: NOOP,
  ask: NOOP,
  cancel: NOOP,
  confirm: NOOP,
};
const NAME = "20261104T000000000Z";
const FIX = "디스크를 확인한 뒤 다시 시도해 주세요";
const FAILURE: StorageFailure = { kind: "environment", message: "디스크 오류", fix: FIX };

function stateOf(over: Partial<StorageState> = {}): StorageState {
  return {
    load: { kind: "ready", usage: STORAGE_USAGE },
    removing: null,
    removeBusy: false,
    removeFailure: null,
    ...over,
  };
}

function html(state: StorageState): string {
  return renderToString(<StorageView state={state} handlers={handlers} locale="ko" />);
}

/** 버튼이 막혔는지. 막힌 단추는 `disabled` 속성을 단다 */
function anyDisabled(out: string): boolean {
  return out.includes('disabled=""');
}

describe("storage section states", () => {
  test("ready shows the data folder, each row's size, and the copy's readable time", () => {
    const out = html(stateOf());
    expect(out).toContain(STORAGE_USAGE.dataDir);
    expect(out).toContain(t("desktop.settings.storage.row.conversations"));
    expect(out).toContain(t("desktop.settings.storage.row.restorePrevious"));
    expect(out).toContain(formatBytes(STORAGE_USAGE.logs));
    expect(out).toContain(t("desktop.settings.storage.folder.open"));
    expect(out).toContain(previousLabelOf(NAME, "ko"));
    expect(out).not.toContain(NAME);
    expect(out).toContain(t("desktop.settings.storage.previous.remove"));
  });

  test("the info tip carries the note on what each row is and that nothing is cleaned by itself", () => {
    const out = html(stateOf());
    expect(out).toContain(t("desktop.settings.storage.info.restorePrevious"));
    expect(out).toContain(t("desktop.settings.storage.info.auto"));
  });

  test("loading shows the reading line and no rows", () => {
    const out = html(stateOf({ load: { kind: "loading" } }));
    expect(out).toContain(t("desktop.settings.storage.loading"));
    expect(out).not.toContain(t("desktop.settings.storage.folder.open"));
  });

  test("a remote engine shows the remote line and no folder or rows", () => {
    const out = html(stateOf({ load: { kind: "remote" } }));
    expect(out).toContain(t("desktop.settings.storage.remote"));
    expect(out).not.toContain(t("desktop.settings.storage.folder.open"));
    expect(out).not.toContain(STORAGE_USAGE.dataDir);
  });

  test("a failed read shows the message and the fix", () => {
    const out = html(stateOf({ load: { kind: "failed", failure: FAILURE } }));
    expect(out).toContain(FAILURE.message);
    expect(out).toContain(FIX);
    expect(out).not.toContain(t("desktop.settings.storage.folder.open"));
  });

  test("a failed removal shows its message and fix inside the block", () => {
    const out = html(stateOf({ removeFailure: FAILURE }));
    expect(out).toContain(FAILURE.message);
    expect(out).toContain(FIX);
  });

  test("the refresh button is disabled while the usage is loading", () => {
    expect(anyDisabled(html(stateOf({ load: { kind: "loading" } })))).toBe(true);
    expect(anyDisabled(html(stateOf()))).toBe(false);
  });

  test("while a removal runs the copy's delete buttons are disabled", () => {
    expect(anyDisabled(html(stateOf({ removeBusy: true })))).toBe(true);
    expect(anyDisabled(html(stateOf()))).toBe(false);
  });
});

describe("the pre-restore copy list", () => {
  test("an empty list shows the muted empty line and no delete button", () => {
    const usage: StorageUsage = { ...STORAGE_USAGE, restorePrevious: 0, previous: [] };
    const out = html(stateOf({ load: { kind: "ready", usage } }));
    expect(out).toContain(t("desktop.settings.storage.previous.empty"));
    expect(out).not.toContain(t("desktop.settings.storage.previous.remove"));
  });

  test("the confirm text names the copy and its size, and says it cannot be undone", () => {
    const out = renderToString(<PreviousConfirmText name={NAME} size="4 KB" />);
    expect(out).toContain(t("desktop.settings.storage.previous.confirm.folder", { name: NAME }));
    expect(out).toContain(t("desktop.settings.storage.previous.confirm.size", { size: "4 KB" }));
    expect(out).toContain(t("desktop.settings.storage.previous.confirm.warn"));
  });

  test("when the copy is not in the list its size line is left out, and the warning stays", () => {
    const out = renderToString(<PreviousConfirmText name={NAME} size={null} />);
    expect(out).not.toContain(t("desktop.settings.storage.previous.confirm.size", { size: "" }));
    expect(out).toContain(t("desktop.settings.storage.previous.confirm.warn"));
  });
});
