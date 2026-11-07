import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { WireError, type WireResult } from "@fresnel/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// workspace.status(F wire §3.3.1). 실제 임시 폴더 위의 처리기다: 있는 폴더, 없는 경로, 파일, 심볼릭 링크, 상대 경로.

const root = realpathSync(mkdtempSync(join(tmpdir(), "xh-wsstatus-")));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function open(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

test("workspace.status says a real folder exists and gives its canonical path, through a symbolic link too", async () => {
  const folder = join(root, "app");
  mkdirSync(folder);
  const link = join(root, "app-link");
  symlinkSync(folder, link);
  const connection = await open(createFakeHost());
  const exists: WireResult<"workspace.status"> = { exists: true, path: folder };
  expect(await connection.request("workspace.status", { workspace: folder })).toEqual(exists);
  expect(await connection.request("workspace.status", { workspace: link })).toEqual(exists);
  await connection.close();
});

test("workspace.status says a missing folder is gone and keeps the absolute path, and a file is not a folder", async () => {
  const missing = join(root, "moved", "app");
  const file = join(root, "note.txt");
  writeFileSync(file, "x");
  const connection = await open(createFakeHost());
  expect(await connection.request("workspace.status", { workspace: missing })).toEqual({
    exists: false,
    path: missing,
  });
  expect(await connection.request("workspace.status", { workspace: file })).toEqual({
    exists: false,
    path: file,
  });
  await connection.close();
});

test("workspace.status refuses a relative path as invalid params and changes nothing", async () => {
  const connection = await open(createFakeHost());
  const relative = await wireErrorOf(connection.request("workspace.status", { workspace: "app" }));
  expect(relative.data.kind).toBe("jsonrpc.invalidParams");
  expect(relative.data.details).toEqual({
    issues: [{ path: "workspace", message: "workspace must be an absolute path" }],
  });
  await connection.close();
});
