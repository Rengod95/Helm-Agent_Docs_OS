import { expect, test } from "bun:test";
import { join } from "node:path";
import { scanDriveSource } from "@xeon/group-kit/testing";

// H-18: drive 함수 본문과 그 안에서 한 단계 부르는 같은 파일 함수에 시각·난수·직접 I/O가 없다

const DRIVE_SOURCE = await Bun.file(join(import.meta.dir, "../../src/drive.ts")).text();
/** 스캐너는 `<식>.drive(함수)` 호출을 찾는다. 등록 줄은 index.ts에 있어 같은 모양의 줄을 덧붙인다 */
const ENTRIES = ["branch", "diverge", "explore", "converge", "apply"] as const;
const REGISTERED = `${DRIVE_SOURCE}\n${ENTRIES.map((name) => `g.drive(${name});`).join("\n")}\n`;

test("drive.source-is-deterministic", () => {
  expect(scanDriveSource(REGISTERED, { fileName: "drive.ts" })).toEqual([]);
});

test("the scan sees a clock, a random source and direct I/O hidden in a one-level helper", () => {
  const tainted = REGISTERED.replace(
    "if (loop.budget.turns === 0) {",
    "if (Date.now() > 0 && Math.random() > 2) await fetch('https://example.test');\n  if (loop.budget.turns === 0) {",
  );
  const found = scanDriveSource(tainted, { fileName: "drive.ts" }).map((finding) => finding.code);
  expect(found).toContain("SD-01");
  expect(found).toContain("SD-03");
});
