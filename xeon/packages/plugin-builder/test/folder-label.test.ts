import { expect, test } from "bun:test";
import { folderLabel } from "../src/folder-label.ts";
import { createOrchestrationRig } from "./group-support.ts";

// 프로젝트 없는 대화의 기본 폴더는 내부 경로라 이름 확인 카드에 보이지 않는다(U-03). 다른 폴더는 경로 그대로다.

const DEFAULT_DIR = "/private/tmp/scnRun-home/fresnel/data/default-project/thr_abc123";
const WORK_DIR = "/Users/me/work/demo";

test("folderLabel: a folder under the internal default project shows the label, and an ordinary folder keeps its path", () => {
  expect(folderLabel(DEFAULT_DIR)).toBe("이 대화의 기본 폴더");
  expect(folderLabel("C:\\data\\default-project\\thr_x")).toBe("이 대화의 기본 폴더");
  expect(folderLabel(WORK_DIR)).toBe(WORK_DIR);
  expect(folderLabel("/work/default-project-notes/demo")).toBe("/work/default-project-notes/demo");
  expect(folderLabel("")).toBe("");
});

test("authoring.name-card: the name question shows the label for the default folder, the stored dir keeps the real path", async () => {
  const rig = await createOrchestrationRig();
  await rig.call("authoring_start", { kind: "single-plugin", name: "demo", dir: DEFAULT_DIR });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  const request = rig.approvals.created[0];
  const shown = JSON.stringify(request?.body);
  expect(shown).toContain('플러그인 \\"demo\\"을 이 대화의 기본 폴더에 만들까요?');
  expect(shown).not.toContain("default-project");
  expect(rig.state()).toMatchObject({ dir: DEFAULT_DIR });
});
