import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { SecretNameSchema } from "@fresnel/contracts/capabilities";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import { createRedactor } from "@fresnel/platform-secrets/testing";
import type { DisplayMaskPort } from "../../src/display-mask.ts";
import { exportFileName, exportLabelOf } from "../../src/export/thread-export.ts";

// 내보내기 파일 이름과 제목 표시(F.wire-settings.spec §3.4.7 [제안]). 제목은 가림을 거친 뒤 쓴다.

const THREAD = parse(ThreadIdSchema, "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV");
if (!THREAD.ok) throw new Error("bad test thread id");
const threadId: ThreadId = THREAD.value;

const NO_MASK: DisplayMaskPort = {
  displayRanges: () => [],
  displayVisibleLength: (text: string) => text.length,
  displayLeafMasks: () => [],
};

const SECRET = "label-probe-value";

function maskingPort(): DisplayMaskPort {
  const redactor = createRedactor();
  const name = parse(SecretNameSchema, "label-token");
  if (!name.ok) throw new Error("bad test secret name");
  const registered = redactor.registerKnown(name.value, new TextEncoder().encode(SECRET));
  if (!registered.ok) throw new Error("the test secret must register");
  return redactor;
}

test("a title is one line and its separators become underscores in the file name", () => {
  expect(exportLabelOf(NO_MASK, threadId, "  회의\n메모/2  ")).toEqual({
    shown: "회의 메모/2",
    stem: "회의 메모_2",
  });
});

test("a missing or blank title falls back to the thread id", () => {
  expect(exportLabelOf(NO_MASK, threadId, null)).toEqual({ shown: threadId, stem: threadId });
  expect(exportLabelOf(NO_MASK, threadId, "   ")).toEqual({ shown: threadId, stem: threadId });
  // 이름에 남는 글이 없으면(점만 있으면) thread id다
  expect(exportLabelOf(NO_MASK, threadId, "...")).toEqual({ shown: "...", stem: threadId });
});

test("a long title is cut to 120 UTF-16 units so the file name fits the schema", () => {
  const label = exportLabelOf(NO_MASK, threadId, "a".repeat(300));
  expect(label.stem).toBe("a".repeat(120));
  expect(label.shown).toBe("a".repeat(300));
});

test("a title that holds a secret shows the masked text and names the file after the thread", () => {
  const label = exportLabelOf(maskingPort(), threadId, `회의 ${SECRET}`);
  expect(label).toEqual({
    shown: "회의 [REDACTED:known:label-token]",
    stem: threadId,
  });
  expect(label.shown).not.toContain(SECRET);
});

test("the file name carries the extension of its format", () => {
  expect(exportFileName("회의 메모", "markdown")).toBe("회의 메모.md");
  expect(exportFileName("회의 메모", "json")).toBe("회의 메모.json");
});
