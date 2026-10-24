import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// sidecar.json는 사이드카 이름·인자·triple 표의 단일 원천이다. 파생물(tauri.conf.json, capabilities, Rust 상수,
// 빌드 스크립트)이 어긋나면 이 시험이 실패한다 (L4.desktop.spec 3.5, plan 2.1).

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

test("tauri.conf.json bundles exactly the sidecar named in sidecar.json", () => {
  const conf = readJson("src-tauri/tauri.conf.json");
  const bundle = conf["bundle"];
  expect(isRecord(bundle)).toBe(true);
  if (!isRecord(bundle)) return;
  expect(stringArray(bundle["externalBin"])).toEqual([`binaries/${name}`]);
});

test("Rust constants match sidecar.json name and args", () => {
  const engine = read("src-tauri/src/engine.rs");
  expect(engine).toContain(`pub const SIDECAR_NAME: &str = "${name}";`);
  const rustArgs = args.map((arg) => `"${arg}"`).join(", ");
  expect(engine).toContain(
    `pub const SIDECAR_ARGS: [&str; ${String(args.length)}] = [${rustArgs}];`,
  );
});

test("the sidecar entry resolves to the compiled engine entry file", () => {
  const entry = String(sidecar["entry"]);
  expect(readFileSync(join(root, entry), "utf8").length).toBeGreaterThan(0);
});

test("the WebView gets no shell plugin permission, only the engine_* app commands", () => {
  const capability = readJson("src-tauri/capabilities/default.json");
  const permissions = stringArray(capability["permissions"]);
  expect(permissions.some((permission) => permission.startsWith("shell:"))).toBe(false);
  const commands = permissions.filter((permission) => permission.startsWith("allow-engine-"));
  expect(commands.toSorted()).toEqual(
    ["attach", "write", "ack", "restart", "detach"]
      .map((verb) => `allow-engine-${verb}`)
      .toSorted(),
  );
});

test("every app command registered in build.rs and main.rs has a capability, and the reverse", () => {
  const build = read("src-tauri/build.rs");
  const main = read("src-tauri/src/main.rs");
  const registered = [...build.matchAll(/"(engine_[a-z]+)"/g)].map((match) => match[1] ?? "");
  const handled = [...main.matchAll(/relay::(engine_[a-z]+)/g)].map((match) => match[1] ?? "");
  expect(registered.toSorted()).toEqual(handled.toSorted());
  const capability = readJson("src-tauri/capabilities/default.json");
  const granted = stringArray(capability["permissions"])
    .filter((permission) => permission.startsWith("allow-engine-"))
    .map((permission) => permission.replace("allow-", "").replaceAll("-", "_"));
  expect(granted.toSorted()).toEqual(registered.toSorted());
});

test("the credit window and ack step documented for the WebView match relay.rs", () => {
  const relay = read("src-tauri/src/relay.rs");
  expect(relay).toContain("pub const CREDIT_WINDOW_BYTES: u64 = 4 * 1024 * 1024;");
  expect(relay).toContain("pub const ACK_STEP_BYTES: u64 = 256 * 1024;");
  const spec = readFileSync(join(root, "../../../docs/xeon/L4/desktop/spec.md"), "utf8");
  expect(spec).toContain("256 KiB");
  expect(spec).toContain("4 MiB");
});
