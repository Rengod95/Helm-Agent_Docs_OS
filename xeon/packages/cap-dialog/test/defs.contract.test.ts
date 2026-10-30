import { describe, expect, test } from "bun:test";
import {
  DIALOG_CAPABILITIES,
  DialogAsk,
  DialogAttachments,
  DialogCommands,
  DialogNotify,
  DialogStatus,
  orderTools,
  WorkspaceImages,
  validateCapability,
  validateCapabilitySet,
  type AnyCapabilityDef,
} from "@xeon/contracts/capabilities";
import { dialogManifest } from "../src/manifest.ts";

const M2: readonly AnyCapabilityDef[] = [
  DialogAsk,
  DialogCommands,
  DialogStatus,
  DialogAttachments,
];

describe("정의 검증", () => {
  test("M2 정의 넷이 validateCapability 이슈 0건이고 집합에도 이름 충돌이 없다", () => {
    for (const def of M2) expect(validateCapability(def)).toEqual([]);
    // 첨부가 requires로 가리키는 workspace.images가 같은 집합에 있어야 한다
    expect(validateCapabilitySet([...M2, WorkspaceImages])).toEqual([]);
    expect(validateCapabilitySet(M2).map((issue) => issue.code)).toEqual(["requires_unresolved"]);
  });

  test("일곱 정의 전체도 이슈가 없다", () => {
    for (const def of DIALOG_CAPABILITIES) expect(validateCapability(def)).toEqual([]);
    expect(validateCapabilitySet([...DIALOG_CAPABILITIES, WorkspaceImages])).toEqual([]);
  });

  test("DialogAttachments.requires가 workspace.images이고 매니페스트와 같다", () => {
    expect(DialogAttachments.requires).toEqual(["workspace.images"]);
    const manifest = dialogManifest();
    expect((manifest.requires ?? []).map((entry) => entry.id)).toEqual(["workspace.images"]);
  });

  test("매니페스트가 제공하는 능력이 구현한 정의와 같다", () => {
    const provided = (dialogManifest().provides ?? []).map(
      (entry) => `${entry.id}@${entry.version}`,
    );
    expect(provided).toEqual([...M2, DialogNotify].map((def) => `${def.id}@${def.version}`));
  });

  test("모델 도구는 ask_user 하나이고 나머지 능력에는 도구가 없다", () => {
    expect(orderTools(M2).map((tool) => tool.name)).toEqual(["ask_user"]);
    for (const def of [DialogCommands, DialogStatus, DialogAttachments]) {
      expect(def.tools).toEqual([]);
    }
  });

  test("ask_user는 순차 실행이고 읽기 전용 힌트와 replay safe를 단다", () => {
    const [tool] = DialogAsk.tools;
    expect(tool).toMatchObject({
      name: "ask_user",
      method: "ask",
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: true },
    });
    expect(DialogCommands.service.methods.run.replay).toBe("unsafe");
  });
});
