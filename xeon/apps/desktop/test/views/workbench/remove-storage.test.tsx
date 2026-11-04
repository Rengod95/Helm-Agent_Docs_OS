import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import {
  dropDataOf,
  keepsDialogOpen,
  removeOutcomeOfError,
  removeDoneCopyOf,
  storageNoteOf,
  totalRowsOf,
  type StoragePreview,
  type StorageTable,
} from "../../../src/views/workbench/remove-model.ts";
import { RemoveDialogBody } from "../../../src/views/workbench/remove-dialog.tsx";

// 지우기 확인의 저장 데이터 구역: 미리 보기 값의 판단(순수 함수)과 상자 본문의 여러 상태(서버 렌더).

const TABLES: readonly StorageTable[] = [
  { name: "x_taskflow_tasks", rows: 312 },
  { name: "x_taskflow_links", rows: 48 },
];

describe("저장 데이터 판단", () => {
  test("읽는 중, 실패, 비었음은 각각 다른 한 줄이고 표가 있으면 줄이 없다", () => {
    expect(storageNoteOf({ kind: "loading" })).toBe("desktop.workbench.remove.storage.loading");
    expect(storageNoteOf({ kind: "failed" })).toBe("desktop.workbench.remove.storage.failed");
    expect(storageNoteOf({ kind: "ready", tables: [] })).toBe(
      "desktop.workbench.remove.storage.none",
    );
    expect(storageNoteOf({ kind: "ready", tables: TABLES })).toBeNull();
  });

  test("행 수 합계는 테이블마다 행을 더한다", () => {
    expect(totalRowsOf(TABLES)).toBe(360);
    expect(totalRowsOf([])).toBe(0);
  });

  test("dropData는 칸을 켰고 표가 있을 때만 참이다", () => {
    expect(dropDataOf(true, TABLES)).toBe(true);
    expect(dropDataOf(true, [])).toBe(false);
    expect(dropDataOf(false, TABLES)).toBe(false);
    expect(dropDataOf(false, [])).toBe(false);
  });

  test("지운 알림은 적용 시점 문장을 제목으로 두고, 저장 테이블이 있을 때만 수를 덧붙인다", () => {
    expect(removeDoneCopyOf("now", 2)).toEqual({
      title: "desktop.workbench.remove.done.now",
      data: 2,
    });
    expect(removeDoneCopyOf("restart", undefined)).toEqual({
      title: "desktop.workbench.remove.done.restart",
      data: null,
    });
    expect(removeDoneCopyOf("nextStepBoundary", 0)).toEqual({
      title: "desktop.workbench.remove.done.boundary",
      data: null,
    });
  });
});

describe("지우기 결과 판단", () => {
  test("이미 없는 이름(3401)은 gone이고 그 밖의 거절과 오류는 failed다", () => {
    expect(removeOutcomeOfError({ kind: "rejected", code: 3401 })).toBe("gone");
    expect(removeOutcomeOfError({ kind: "rejected", code: 3402 })).toBe("failed");
    expect(removeOutcomeOfError({ kind: "offline" })).toBe("failed");
  });

  test("저장 데이터 지우기가 실패했을 때만 상자를 열어 두고, 이미 없으면 닫는다", () => {
    expect(keepsDialogOpen("failed", true)).toBe(true);
    expect(keepsDialogOpen("failed", false)).toBe(false);
    expect(keepsDialogOpen("gone", true)).toBe(false);
    expect(keepsDialogOpen("removed", true)).toBe(false);
  });
});

function bodyHtml(over: {
  readonly preview: StoragePreview;
  readonly checked?: boolean;
  readonly dataFailed?: boolean;
}): string {
  return renderToString(
    <RemoveDialogBody
      preview={over.preview}
      checked={over.checked ?? false}
      busy={false}
      dataFailed={over.dataFailed ?? false}
      onChecked={() => undefined}
      onRetry={() => undefined}
    />,
  );
}

const DROP_LABEL = t("desktop.workbench.remove.storage.drop");
const WARNING = t("desktop.workbench.remove.storage.warning");

describe("지우기 상자 본문", () => {
  test("읽는 중에는 불러오는 줄과 상태 역할을 보이고 칸은 없다", () => {
    const out = bodyHtml({ preview: { kind: "loading" } });
    expect(out).toContain(t("desktop.workbench.remove.storage.loading"));
    expect(out).toContain('role="status"');
    expect(out).not.toContain(DROP_LABEL);
    expect(out).not.toContain('role="checkbox"');
  });

  test("표는 mono 이름과 행 수를 정확한 숫자로, 합계와 기본 꺼진 칸을 보인다", () => {
    const out = bodyHtml({ preview: { kind: "ready", tables: TABLES } });
    expect(out).toContain("x_taskflow_tasks");
    expect(out).toContain("312행");
    expect(out).toContain("x_taskflow_links");
    expect(out).toContain("48행");
    expect(out).toContain("합계 360행");
    expect(out).toContain(DROP_LABEL);
    expect(out).toContain('role="checkbox"');
    expect(out).toContain('aria-checked="false"');
    expect(out).not.toContain(WARNING);
  });

  test("칸을 켜면 되돌릴 수 없다는 경고와 대화 기록이 남는다는 말을 보인다", () => {
    const out = bodyHtml({ preview: { kind: "ready", tables: TABLES }, checked: true });
    expect(out).toContain('aria-checked="true"');
    expect(out).toContain(WARNING);
    expect(out).toContain("대화 기록은 남아요");
  });

  test("저장 테이블이 비었으면 확인된 데이터가 없다는 한 줄만 있고 칸은 없다", () => {
    const out = bodyHtml({ preview: { kind: "ready", tables: [] } });
    expect(out).toContain(t("desktop.workbench.remove.storage.none"));
    expect(out).not.toContain(DROP_LABEL);
    expect(out).not.toContain('role="checkbox"');
    expect(out).not.toContain(WARNING);
  });

  test("미리 보기를 못 읽으면 조용한 한 줄과 다시 확인 단추를 보이고, 경고 상자는 없다", () => {
    const out = bodyHtml({ preview: { kind: "failed" } });
    expect(out).toContain(t("desktop.workbench.remove.storage.failed"));
    expect(out).toContain(t("desktop.workbench.remove.storage.retry"));
    expect(out).not.toContain('role="alert"');
    expect(out).not.toContain(DROP_LABEL);
    expect(out).not.toContain('role="checkbox"');
  });

  test("저장 데이터를 함께 지우다 실패하면 경고 상자로 알린다", () => {
    const out = bodyHtml({
      preview: { kind: "ready", tables: TABLES },
      checked: true,
      dataFailed: true,
    });
    expect(out).toContain('role="alert"');
    expect(out).toContain(t("desktop.workbench.remove.dataFailed"));
  });
});
