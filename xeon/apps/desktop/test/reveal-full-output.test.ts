import { describe, expect, test } from "bun:test";
import { revealFullOutput } from "../src/views/convo/reveal-full-output.ts";

// 셸 명령은 문자열 코드를 그대로 거절한다(preload). 시험도 같은 모양으로 거절한다
function rejectWith(reason: unknown): Promise<unknown> {
  // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- 셸 명령은 문자열 코드를 그대로 거절 값으로 준다 (L4.desktop.design)
  return Promise.reject(reason);
}

describe("revealFullOutput", () => {
  test("asks the shell to reveal exactly the full output path", async () => {
    const calls: { command: string; args: unknown }[] = [];
    const result = await revealFullOutput(
      {
        invoke: (command, args) => {
          calls.push({ command, args });
          return Promise.resolve(null);
        },
      },
      "/tmp/out-1.txt",
    );
    expect(result).toBe("revealed");
    expect(calls).toEqual([{ command: "reveal_path", args: { path: "/tmp/out-1.txt" } }]);
  });

  test("not_found means the file is not on this computer, any other rejection is failed", async () => {
    const results = await Promise.all(
      [new Error("not_found"), "not_found", new Error("open_failed"), "open_failed", 42].map(
        (reason) => revealFullOutput({ invoke: () => rejectWith(reason) }, "/tmp/out-2.txt"),
      ),
    );
    expect(results).toEqual(["missing", "missing", "failed", "failed", "failed"]);
  });
});
