import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { err } from "@fresnel/contracts";
import { openScriptBox, sandboxAvailable, type ScriptBox } from "../support/script-box.ts";

// 초안(검토 전) 스크립트가 승인 카드를 거친 뒤 같은 샌드박스에서 도는 것을 실제 샌드박스로 본다(AGE-58 2부). 카드는 승인 문 대역이다.
// 샌드박스를 쓸 수 없으면 건너뛴다. FRESNEL_REQUIRE_SANDBOX=1 또는 CI이면 종료 코드 2(환경 문제)로 끝난다.

const ENVIRONMENT_EXIT_CODE = 2;
const TEST_TIMEOUT_MS = 60_000;

const probe = await openScriptBox();
const available = sandboxAvailable(probe);
const reason = probe.service.status().reason ?? "the sandbox service is not available";
await probe.close();
if (!available) {
  if (Bun.env["FRESNEL_REQUIRE_SANDBOX"] === "1" || Bun.env["CI"] === "true") {
    process.stderr.write(`ENV script-boundary.int: ${reason}\n`);
    process.exit(ENVIRONMENT_EXIT_CODE);
  }
  process.stderr.write("SKIPPED script-boundary.int: sandbox not runnable here\n");
}
const suite = available ? describe : describe.skip;

/** 스크립트가 `이름=값` 줄로 적은 결과를 읽는다 */
async function resultsOf(
  box: ScriptBox,
  spec: Parameters<ScriptBox["run"]>[0],
): Promise<Record<string, string>> {
  const outcome = await box.run(spec);
  if (typeof outcome === "string") throw new Error(outcome);
  const results: Record<string, string> = {};
  for (const line of outcome.stdout.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) results[line.slice(0, at)] = line.slice(at + 1);
  }
  return results;
}

/** 셸 내장만 쓰는 검사 함수. 명령이 성공하면 open, 아니면 blocked다 */
const PROBE_FN = `t() { local label=$1; shift; if "$@" 2>/dev/null; then echo "$label=open"; else echo "$label=blocked"; fi; }\n`;

suite("a draft script under the gate (AGE-58)", () => {
  test(
    "a draft script runs in this same sandbox only after the card is approved: the approved run cannot read outside the folder, and a declined card starts nothing",
    async () => {
      const box = await openScriptBox();
      writeFileSync(
        join(box.outside, "secret.txt"),
        "fake secret in a temp folder made by this test",
      );
      const body = `${PROBE_FN}t read_secret bash -c "exec 3< $1"\nt write_marker bash -c "echo x > $2"\necho ran=yes\n`;
      const marker = join(box.outside, "marker.txt");
      const seen: string[] = [];
      try {
        const approved = await resultsOf(box, {
          runner: "bash",
          args: [join(box.outside, "secret.txt"), marker],
          body,
          draft: {
            gate: (call) => {
              seen.push(call.card.command);
              return call.run(new AbortController().signal);
            },
          },
        });
        expect(approved).toEqual({ read_secret: "blocked", write_marker: "blocked", ran: "yes" });
        expect(seen).toEqual(["/bin/bash"]);
        const declined = await box.run({
          runner: "bash",
          args: [join(box.outside, "secret.txt"), marker],
          body: `echo ran=yes > ${join(box.outside, "declined.txt")}\n`,
          draft: {
            gate: () =>
              Promise.resolve(err({ kind: "script_denied", cause: "denied", resolvedBy: "human" })),
          },
        });
        expect(declined).toBe(
          'failure:{"kind":"script_denied","cause":"denied","resolvedBy":"human"}',
        );
        expect(existsSync(join(box.outside, "declined.txt"))).toBe(false);
      } finally {
        await box.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
