import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

// M3 (int): 클라이언트가 trust.get으로 묻고 trust.decide로 정한다. 엔진은 프롬프트를 띄우지 않아(headless) 결정이 없는 폴더는 불신이고,
// 결정은 이미 열린 thread의 프로젝트 설정 층에 바로 반영되며 저장 파일에 남아 재시작 뒤에도 유지된다. 실제 엔진과 임시 홈 위의 시험이다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const KEY = "l1.loop.maxSteps";

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

realTest(
  "an undecided workspace is untrusted until the client decides; the decision applies to the open thread and survives a restart",
  async () => {
    const home = useEngineHome();
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-ws-")));
    mkdirSync(join(workspace, ".xeon"));
    writeFileSync(join(workspace, ".xeon", "settings.json"), JSON.stringify({ [KEY]: 8 }));

    const first = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(first.client);
    await connection.request("host.hello", HELLO_PARAMS);

    const asked = await connection.request("trust.get", { workspace });
    expect(asked).toMatchObject({
      projectRoot: workspace,
      required: true,
      verdict: "undecided",
      via: "headless",
    });
    expect(asked.resources).toContain(".xeon/settings.json");
    expect(asked.options.map((option) => option.label)).toEqual([
      "trust-folder",
      "trust-parent",
      "trust-session",
      "deny-folder",
      "deny-session",
    ]);

    // 결정 전에는 프로젝트 설정 파일이 적용되지 않는다
    const created = await connection.request("thread.create", { workspace });
    const before = await connection.request("settings.get", {
      keys: [KEY],
      threadId: created.threadId,
    });
    expect(before.settings[0]).toMatchObject({ source: { scope: "default" } });

    // 선택지에 없는 결정과 상대 경로는 거부한다
    const relative = await wireErrorOf(connection.request("trust.get", { workspace: "app" }));
    expect(relative.data.kind).toBe("jsonrpc.invalidParams");

    const allowed = await connection.request("trust.decide", {
      workspace,
      choice: { kind: "folder", verdict: "allow" },
    });
    expect(allowed).toMatchObject({ verdict: "allow", via: "store" });
    const after = await connection.request("settings.get", {
      keys: [KEY],
      threadId: created.threadId,
    });
    expect(after.settings[0]).toMatchObject({ value: 8, source: { scope: "project" } });
    const trustFile = join(home.root, "config", "trust.json");
    expect(readFileSync(trustFile, "utf8")).toContain(workspace);

    const denied = await connection.request("trust.decide", {
      workspace,
      choice: { kind: "folder", verdict: "deny" },
    });
    expect(denied).toMatchObject({ verdict: "deny", via: "store" });
    const revoked = await connection.request("settings.get", {
      keys: [KEY],
      threadId: created.threadId,
    });
    expect(revoked.settings[0]).toMatchObject({ source: { scope: "default" } });
    await connection.close();
    await first.close();

    // 재시작 뒤에도 저장한 결정이 유지된다
    const second = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const reopened = createHostConnection(second.client);
    await reopened.request("host.hello", HELLO_PARAMS);
    expect(await reopened.request("trust.get", { workspace })).toMatchObject({
      verdict: "deny",
      via: "store",
    });

    // 세션 결정은 저장하지 않는다
    const session = await reopened.request("trust.decide", {
      workspace,
      choice: { kind: "session", verdict: "allow" },
    });
    expect(session).toMatchObject({ verdict: "allow", via: "sessionMemory" });
    expect(readFileSync(trustFile, "utf8")).toContain('"deny"');
    await reopened.close();
    await second.close();
    expect(existsSync(trustFile)).toBe(true);
    rmSync(workspace, { recursive: true, force: true });
    home.dispose();
  },
  30_000,
);
