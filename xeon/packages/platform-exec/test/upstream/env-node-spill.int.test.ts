import * as Fs from "node:fs";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// XEON-PATCH: P4
import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
// XEON-PATCH: P5
import type { CancelScope } from "@xeon/contracts/services";
import { getOrThrow } from "../../src/upstream/env/index.ts";
import { NodeExecutionEnv } from "../../src/upstream/env/node.ts";
import { hostPlatform } from "../support/platform.ts";

// XEON-PATCH: P5
const BACKGROUND_CONTEXT: CancelScope = { abortSignal: undefined };
// XEON-PATCH: P3
const platform = hostPlatform();
// Longer than the shell's post-exit stdio grace period plus the descendant's delayed write.
const SPILL_WRITE_DELAY_MS = 600;
// XEON-PATCH: P4
const spill = { rejectedWrites: 0 };

// Make the spill stream deterministically slow and immediately backpressured.
// XEON-PATCH: P4
const actual: typeof Fs = { ...Fs };
// XEON-PATCH: P15
/** Delays a stream's internal write hook. Node documents `_write`/`_writev` as the hooks a stream implementation provides. */
function delayHook(stream: Fs.WriteStream, name: "_write" | "_writev"): void {
  const original: unknown = Reflect.get(stream, name);
  if (typeof original !== "function") return;
  Object.defineProperty(stream, name, {
    value: (...args: unknown[]): void => {
      setTimeout(() => {
        Reflect.apply(original, stream, args);
      }, SPILL_WRITE_DELAY_MS);
    },
  });
}

// XEON-PATCH: P4
// XEON-PATCH: P15
await mock.module("node:fs", () => {
  return {
    ...actual,
    createWriteStream: (
      path: Fs.PathLike,
      options?: Parameters<typeof Fs.createWriteStream>[1],
    ) => {
      const stream = actual.createWriteStream(
        path,
        typeof options === "object" ? { ...options, highWaterMark: 1 } : { highWaterMark: 1 },
      );
      delayHook(stream, "_write");
      delayHook(stream, "_writev");
      const write = stream.write.bind(stream);
      // XEON-PATCH: P14
      Object.defineProperty(stream, "write", {
        value: (...args: Parameters<Fs.WriteStream["write"]>): boolean => {
          const accepted: unknown = Reflect.apply(write, stream, args);
          if (accepted !== true) spill.rejectedWrites++;
          return accepted === true;
        },
      });
      return stream;
    },
  };
});

// XEON-PATCH: P4
afterAll(async () => {
  // XEON-PATCH: P15
  await mock.module("node:fs", () => actual);
});

const tempDirs: string[] = [];

afterEach(() => {
  spill.rejectedWrites = 0;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("NodeExecutionEnv spill backpressure", () => {
  it.skipIf(process.platform === "win32")(
    "keeps inherited stdio open past the exit grace period while a spill write is pending",
    async () => {
      const root = join(
        tmpdir(),
        `pi-durable-env-spill-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      mkdirSync(root, { recursive: true });
      tempDirs.push(root);
      const env = new NodeExecutionEnv({ platform, cwd: root });
      // The shell exits after the first chunk crosses the spill threshold and backpressures the spill. A background
      // descendant retains stdout and writes after the post-exit grace period. Without the pending-spill guard,
      // settlement destroys stdout before that descendant output is read.
      const command = "printf '%020d' 0 | tr 0 a; (sleep 0.2; printf '%01000d' 0 | tr 0 b) &";

      let output = "";
      const result = getOrThrow(
        await env.exec(
          command,
          {
            spill: { afterBytes: 10, afterLines: 10 },
            onOutput: (text) => {
              output += text;
            },
          },
          BACKGROUND_CONTEXT,
        ),
      );

      expect(spill.rejectedWrites).toBeGreaterThan(0);
      expect(output).toHaveLength(1020);
      expect(result.spillPath).toBeDefined();
      tempDirs.push(join(result.spillPath!, ".."));
      expect(getOrThrow(await env.readTextFile(result.spillPath!, BACKGROUND_CONTEXT))).toBe(
        `${"a".repeat(20)}${"b".repeat(1000)}`,
      );
    },
    10_000,
  );
});
