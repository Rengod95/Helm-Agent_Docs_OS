import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { McpServerDef } from "@fresnel/contracts/capabilities";
import type { SettingsReadFileResult, SettingsWriteFileResult } from "@fresnel/contracts/wire";
import type { SettingsFileWrite } from "../../src/views/commands.ts";
import { persistServer } from "../../src/views/pages/settings/settings-mcp-write.ts";
import { fakeCommands } from "./fake-commands.ts";

// 서버 정의 쓰기: 설정 파일을 읽은 해시(`baseSha256`)로 다시 쓰고, 읽은 뒤 파일이 바뀌었으면 덮어쓰지 않는다.

const STDIO: McpServerDef = { transport: { type: "stdio", command: "node" } };

function fileOf(text: string, sha256: string | null): SettingsReadFileResult {
  return {
    scope: "user",
    path: "/home/u/settings.json",
    exists: sha256 !== null,
    readOnly: false,
    text,
    sha256,
    unknownKeys: [],
  };
}

function writtenOf(sha256: string): SettingsWriteFileResult {
  return { path: "/home/u/settings.json", sha256, unknownKeys: [] };
}

describe("persistServer", () => {
  test("writes the whole file with the new server, keeping other keys, and sends the sha256 it read", async () => {
    const writes: SettingsFileWrite[] = [];
    const commands = fakeCommands({
      settings: {
        ...fakeCommands().settings,
        readFile: () =>
          Promise.resolve(
            ok(
              fileOf(
                '{"ui.theme":"dark","l2.mcp.servers":{"a":{"transport":{"type":"stdio","command":"x"}}}}',
                "sha-1",
              ),
            ),
          ),
        writeFile: (write) => {
          writes.push(write);
          return Promise.resolve(ok(writtenOf("sha-2")));
        },
      },
    });
    const result = await persistServer(commands, { previousId: null, id: "b", def: STDIO });
    expect(result).toBeNull();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ scope: "user", threadId: null, baseSha256: "sha-1" });
    expect(JSON.parse(writes[0]?.text ?? "")).toEqual({
      "ui.theme": "dark",
      "l2.mcp.servers": {
        a: { transport: { type: "stdio", command: "x" } },
        b: { transport: { type: "stdio", command: "node" } },
      },
    });
  });

  test("a file that did not exist is written with a null base hash", async () => {
    const writes: SettingsFileWrite[] = [];
    const commands = fakeCommands({
      settings: {
        ...fakeCommands().settings,
        readFile: () => Promise.resolve(ok(fileOf("", null))),
        writeFile: (write) => {
          writes.push(write);
          return Promise.resolve(ok(writtenOf("sha-new")));
        },
      },
    });
    expect(await persistServer(commands, { previousId: null, id: "a", def: STDIO })).toBeNull();
    expect(writes[0]?.baseSha256).toBeNull();
  });

  test("a conflict says the settings changed somewhere else and does not retry", async () => {
    let writes = 0;
    const commands = fakeCommands({
      settings: {
        ...fakeCommands().settings,
        readFile: () => Promise.resolve(ok(fileOf("{}", "sha-1"))),
        writeFile: () => {
          writes += 1;
          return Promise.resolve(err({ kind: "conflict" }));
        },
      },
    });
    const result = await persistServer(commands, { previousId: null, id: "a", def: STDIO });
    expect(result).toEqual({ id: "desktop.settings.mcp.error.conflict" });
    expect(writes).toBe(1);
  });

  test("a rejected write shows the host's sentence", async () => {
    const commands = fakeCommands({
      settings: {
        ...fakeCommands().settings,
        readFile: () => Promise.resolve(ok(fileOf("{}", "sha-1"))),
        writeFile: () =>
          Promise.resolve(err({ kind: "rejected", code: 3108, detail: "bad value" })),
      },
    });
    const result = await persistServer(commands, { previousId: null, id: "a", def: STDIO });
    expect(result).toEqual({
      id: "desktop.settings.mcp.error.detail",
      args: { detail: "bad value" },
    });
  });

  test("an unreadable file is not written", async () => {
    let writes = 0;
    const commands = fakeCommands({
      settings: {
        ...fakeCommands().settings,
        readFile: () => Promise.resolve(ok(fileOf("not json", "sha-1"))),
        writeFile: () => {
          writes += 1;
          return Promise.resolve(ok(writtenOf("x")));
        },
      },
    });
    const result = await persistServer(commands, { previousId: null, id: "a", def: STDIO });
    expect(result).toEqual({ id: "desktop.settings.mcp.error.tableUnreadable" });
    expect(writes).toBe(0);
  });

  test("removing a server writes the table without it", async () => {
    const writes: SettingsFileWrite[] = [];
    const commands = fakeCommands({
      settings: {
        ...fakeCommands().settings,
        readFile: () =>
          Promise.resolve(
            ok(
              fileOf(
                '{"l2.mcp.servers":{"a":{"transport":{"type":"stdio","command":"x"}}}}',
                "sha-1",
              ),
            ),
          ),
        writeFile: (write) => {
          writes.push(write);
          return Promise.resolve(ok(writtenOf("sha-2")));
        },
      },
    });
    expect(await persistServer(commands, { previousId: "a", id: "a", def: null })).toBeNull();
    expect(JSON.parse(writes[0]?.text ?? "")).toEqual({ "l2.mcp.servers": {} });
  });
});
