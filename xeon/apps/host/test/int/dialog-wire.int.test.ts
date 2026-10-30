import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { WireError } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M3-REQ-16, M3-20 (int): 실제 cap-dialog 위의 `attachments.add`와 `status.list`. 첨부 파트는 `turn.start` 입력으로 그대로 들어가고,
// 턴이 끝난 뒤 상태줄 스냅숏에는 내장 세그먼트 `core.turn`이 "대기"로 남는다(L2.dialog.spec §4.4).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "attachments.add gives turn input parts for a text file, and status.list shows the segment after the turn",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "xh-attach-")));
    const file = join(folder, "note.txt");
    writeFileSync(file, "hello attachment");
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: answeringModels("dialog-wire", "done."),
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    try {
      const created = await connection.request("thread.create", {});
      const added = await connection.request("attachments.add", {
        threadId: created.threadId,
        source: { kind: "path", path: file },
      });
      expect(added.attachment).toMatchObject({
        kind: "text",
        name: "note.txt",
        mime: "text/plain",
        size: 16,
        path: file,
        url: null,
        image: null,
      });
      expect(added.attachment.blob).not.toBeNull();
      expect(added.parts).toEqual([
        {
          type: "text",
          text: `<attachment name="note.txt" path="${file}">\nhello attachment\n</attachment>`,
        },
      ]);

      await connection.request("turn.start", { threadId: created.threadId, input: added.parts });
      await collector.waitFor((event) => event.kind === "turn.completed");
      const status = await connection.request("status.list", { threadId: created.threadId });
      expect(status.items).toContainEqual({
        id: "core.turn",
        text: "대기",
        tone: "normal",
        order: 100,
      });
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
      rmSync(folder, { recursive: true, force: true });
    }
  },
  30_000,
);

realTest(
  "status.list and attachments.add on a thread that does not exist are thread.notFound",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "xh-attach-")));
    const file = join(folder, "note.txt");
    writeFileSync(file, "hello");
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    try {
      const created = await connection.request("thread.create", {});
      await connection.request("thread.delete", { threadId: created.threadId });
      const listed = await rejectionOf(
        connection.request("status.list", { threadId: created.threadId }),
      );
      expect(listed).toBeInstanceOf(WireError);
      if (listed instanceof WireError) expect(listed.code).toBe(3001);
      const added = await rejectionOf(
        connection.request("attachments.add", {
          threadId: created.threadId,
          source: { kind: "path", path: file },
        }),
      );
      expect(added).toBeInstanceOf(WireError);
      if (added instanceof WireError) expect(added.code).toBe(3001);
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
      rmSync(folder, { recursive: true, force: true });
    }
  },
  30_000,
);

realTest(
  "attachments.add reports a file that is not there as invalid params on the source",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "xh-attach-")));
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    try {
      const missing = await rejectionOf(
        connection.request("attachments.add", {
          source: { kind: "path", path: join(folder, "missing.txt") },
        }),
      );
      expect(missing).toBeInstanceOf(WireError);
      if (missing instanceof WireError) {
        expect(missing.data.kind).toBe("jsonrpc.invalidParams");
        expect(missing.data.details).toEqual({
          issues: [{ path: "source", message: expect.any(String) }],
        });
      }
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
      rmSync(folder, { recursive: true, force: true });
    }
  },
  30_000,
);
