import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// sidecar.json는 사이드카 이름·인자·triple 표의 단일 원천이다. 파생물(Electron 셸의 상수, 빌드 스크립트)이
// 어긋나면 이 시험이 실패한다 (L4.desktop.spec 3.5, plan 2.1).

const root = join(import.meta.dir, "..");

function read(relative: string): string {
  return readFileSync(join(root, relative), "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(relative: string): Record<string, unknown> {
  const data: unknown = JSON.parse(read(relative));
  if (!isRecord(data)) throw new Error(`${relative} is not an object`);
  return data;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

const sidecar = readJson("sidecar.json");
const name = String(sidecar["name"]);
const args = stringArray(sidecar["args"]);

test("the Electron shell's sidecar name and args constants match sidecar.json", () => {
  const shell = read("../desktop-shell/src/main/lib/sidecar.ts");
  expect(shell).toContain(`export const SIDECAR_NAME = "${name}";`);
  const shellArgs = args.map((arg) => `"${arg}"`).join(", ");
  expect(shell).toContain(`export const SIDECAR_ARGS = [${shellArgs}] as const;`);
});

test("the sidecar entry resolves to the compiled engine entry file", () => {
  const entry = String(sidecar["entry"]);
  expect(readFileSync(join(root, entry), "utf8").length).toBeGreaterThan(0);
});

test("the credit window and ack step documented for the WebView match the shell relay", () => {
  const relay = read("../desktop-shell/src/main/engine/relay.ts");
  expect(relay).toContain("export const CREDIT_WINDOW_BYTES: number = 4 * 1024 * 1024;");
  expect(relay).toContain("export const ACK_STEP_BYTES: number = 256 * 1024;");
  const spec = readFileSync(join(root, "../../../docs/xeon/L4/desktop/spec.md"), "utf8");
  expect(spec).toContain("256 KiB");
  expect(spec).toContain("4 MiB");
});
