import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { wireErrorOf } from "../fixtures/service-harness.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// `knowledge.memory.read`·`add`·`replace`·`remove`(W-19)를 실제 엔진의 기억 기능 위에서 본다(Y6: wire 메서드마다 host 통합 시험).
// 처리기 시험(test/handlers/dialog-area.test.ts)은 가짜 포트로 값을 옮기는 것만 보고, 여기서는 파일에 실제로 쓰이는지 본다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "memory entries added, replaced and removed over the wire change the user store, and a stale baseHash is refused",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: answeringModels("knowledge-memory-wire", "unused"),
    });
    try {
      const connection = createHostConnection(host.client);
      await connection.request("host.hello", HELLO_PARAMS);

      const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      const empty = await connection.request("knowledge.memory.read", { stores: ["user"] });
      expect(empty.stores).toEqual([
        {
          store: "user",
          entries: [],
          usedChars: 0,
          limitChars: 1375,
          fileHash: EMPTY_HASH,
          writeBlocked: false,
        },
      ]);

      const added = await connection.request("knowledge.memory.add", {
        store: "user",
        text: "prefers short answers",
      });
      expect(added.outcome.status).toBe("applied");
      expect(added.view.entries).toEqual([
        { id: expect.any(String), text: "prefers short answers", chars: 21 },
      ]);
      expect(added.view.fileHash).not.toBe(EMPTY_HASH);
      const entry = added.view.entries[0];
      if (entry === undefined) throw new Error("the added entry is missing");
      // read sees what add wrote
      const readBack = await connection.request("knowledge.memory.read", { stores: ["user"] });
      expect(readBack.stores[0]?.entries).toEqual(added.view.entries);
      expect(readBack.stores[0]?.fileHash).toBe(added.view.fileHash);

      // the same text twice is refused by the capability, and nothing changes
      const duplicate = await wireErrorOf(
        connection.request("knowledge.memory.add", {
          store: "user",
          text: "prefers short answers",
        }),
      );
      expect(duplicate.code).not.toBe(0);

      // replace with the hash read above
      const replaced = await connection.request("knowledge.memory.replace", {
        store: "user",
        entryId: entry.id,
        text: "prefers long answers",
        baseHash: added.view.fileHash,
      });
      expect(replaced.outcome.status).toBe("applied");
      expect(replaced.view.entries.map((item) => item.text)).toEqual(["prefers long answers"]);

      // a baseHash from before the replace is stale: refused, the entry stays
      const replacedEntry = replaced.view.entries[0];
      if (replacedEntry === undefined) throw new Error("the replaced entry is missing");
      const stale = await wireErrorOf(
        connection.request("knowledge.memory.remove", {
          store: "user",
          entryId: replacedEntry.id,
          baseHash: added.view.fileHash,
        }),
      );
      expect(stale.code).toBe(-32602);
      const stillThere = await connection.request("knowledge.memory.read", { stores: ["user"] });
      expect(stillThere.stores[0]?.entries.map((item) => item.text)).toEqual([
        "prefers long answers",
      ]);

      // remove with the current hash empties the store
      const removed = await connection.request("knowledge.memory.remove", {
        store: "user",
        entryId: replacedEntry.id,
        baseHash: replaced.view.fileHash,
      });
      expect(removed.outcome.status).toBe("applied");
      expect(removed.view.entries).toEqual([]);
      expect(removed.view.fileHash).toBe(EMPTY_HASH);
      await connection.close();
    } finally {
      await host.close();
      home.dispose();
    }
  },
  30_000,
);
