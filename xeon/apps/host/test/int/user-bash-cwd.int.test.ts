import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import {
  defineManifest,
  type ExtensionEntry,
  type UserBashPayload,
} from "@xeon/contracts/extensions";
import { LoopServicePortKey, type LoopService } from "@xeon/contracts/services";
import { hostOf } from "@xeon/ext-host";
import { assemble } from "../../src/assemble.ts";
import { sequentially } from "../../src/util.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";

// 결정 L2: `user_bash` 지점 페이로드의 cwd는 그 대화의 작업 디렉터리다. 조립 루트가 core-loop에 대화별 함수를 넘기므로
// 작업 디렉터리가 다른 두 대화는 서로 다른 cwd를 보고, 작업 디렉터리가 없는 대화는 빈 문자열을 본다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const home = useEngineHome();
const alpha = mkdtempSync(join(tmpdir(), "xeon-user-bash-alpha-"));
const beta = mkdtempSync(join(tmpdir(), "xeon-user-bash-beta-"));
afterAll(() => {
  home.dispose();
  rmSync(alpha, { recursive: true, force: true });
  rmSync(beta, { recursive: true, force: true });
});

interface Captured {
  loop: LoopService | undefined;
  readonly payloads: UserBashPayload[];
}

// 명령을 실행하지 않도록 지점에서 거부하고 페이로드만 모은다
function observerModule(into: Captured) {
  const manifest = defineManifest({
    schemaVersion: 1,
    name: "user-bash-cwd-observer",
    version: "0.1.0",
    layer: "plugin",
    kind: "plugin",
    entry: "./index.ts",
    points: ["user_bash"],
    usesDrive: false,
    trust: { level: "builtin" },
  });
  const extension: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, {}, (g) => {
      into.loop = hostOf(g).port(LoopServicePortKey);
      g.on("user_bash", (payload) => {
        into.payloads.push(payload);
        return { type: "deny", reason: "observed" };
      });
    });
  };
  return { manifest, extension };
}

realTest(
  "user_bash sees the working directory of the thread it runs in",
  async () => {
    const captured: Captured = { loop: undefined, payloads: [] };
    const engine = await assemble({
      mode: "in-process",
      dataDir: home.dataDir,
      extraPlugins: [observerModule(captured)],
    });
    try {
      const { loop } = captured;
      if (loop === undefined) throw new Error("the observer extension did not start");
      const threads = await Promise.all([
        engine.ports.threads.create({ workspace: alpha }),
        engine.ports.threads.create({ workspace: beta }),
        engine.ports.threads.create({}),
      ]);
      const outcomes: Awaited<ReturnType<LoopService["runUserBash"]>>[] = [];
      await sequentially(threads, async (created) => {
        const locked = await engine.ports.locks.tryAcquire(created.threadId, "cli");
        if (!locked.ok) throw new Error("the thread is locked by someone else");
        outcomes.push(
          await loop.runUserBash({
            threadId: created.threadId,
            command: "pwd",
            excludeFromContext: true,
          }),
        );
      });
      expect(outcomes.map((outcome) => outcome.ok && outcome.value.status)).toEqual([
        "denied",
        "denied",
        "denied",
      ]);
      expect(captured.payloads.map((payload) => payload.cwd)).toEqual([alpha, beta, ""]);
    } finally {
      await engine.close();
    }
  },
  30_000,
);
