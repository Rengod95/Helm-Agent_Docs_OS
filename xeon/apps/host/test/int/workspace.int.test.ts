import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { WireError } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// G2-02 (int): 대화의 작업 폴더는 정규 경로로 저장되어, 클라이언트가 어떤 이름(심볼릭 링크, 뒤 슬래시)으로 부르든 목록 필터와
// 프로젝트 신뢰(trust.get)가 같은 폴더를 가리킨다. 데스크톱 사이드카의 작업 디렉터리는 홈이라 대화의 폴더를 따로 전달해야 한다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "a workspace given through a link is stored canonically, filters by any spelling and is the folder trust.get judges",
  async () => {
    const home = useEngineHome();
    const base = realpathSync(mkdtempSync(join(tmpdir(), "xh-wsint-")));
    const project = join(base, "real", "project");
    mkdirSync(project, { recursive: true });
    const link = join(base, "link");
    symlinkSync(project, link);
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    try {
      const created = await connection.request("thread.create", { workspace: `${link}/` });
      const other = await connection.request("thread.create", {});
      const byLink = await connection.request("thread.list", { workspace: link });
      expect(byLink.threads.map((row) => [row.threadId, row.workspace])).toEqual([
        [created.threadId, project],
      ]);
      const byCanonical = await connection.request("thread.list", { workspace: project });
      expect(byCanonical.threads.map((row) => row.threadId)).toEqual([created.threadId]);
      expect(other.threadId).not.toBe(created.threadId);
      // 신뢰 판정이 보는 폴더도 같은 문자열이다
      const trust = await connection.request("trust.get", { workspace: link });
      expect(byLink.threads[0]?.workspace).toBe(trust.projectRoot);
    } finally {
      await connection.close();
      await host.close();
      rmSync(base, { recursive: true, force: true });
      home.dispose();
    }
  },
  30_000,
);

realTest(
  "thread.create refuses a relative path, a missing folder and a file, and creates nothing",
  async () => {
    const home = useEngineHome();
    const base = realpathSync(mkdtempSync(join(tmpdir(), "xh-wsint-")));
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    try {
      for (const workspace of ["relative/dir", join(base, "missing")]) {
        // eslint-disable-next-line no-await-in-loop -- 둘뿐이고 차례로 본다
        const caught = await rejectionOf(connection.request("thread.create", { workspace }));
        expect(caught).toBeInstanceOf(WireError);
        if (caught instanceof WireError) {
          expect(caught.data.kind).toBe("jsonrpc.invalidParams");
          expect(JSON.stringify(caught.data.details)).toContain("workspace");
        }
      }
      expect((await connection.request("thread.list", {})).threads).toEqual([]);
    } finally {
      await connection.close();
      await host.close();
      rmSync(base, { recursive: true, force: true });
      home.dispose();
    }
  },
  30_000,
);
