import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson } from "@xeon/contracts";
import { WIRE_PROTOCOL_VERSION } from "@xeon/contracts/wire";

// 컴파일 바이너리가 사이드카로 도는 모양과 같다: `xeon host --stdio`를 실제 프로세스로 띄우고 JSON Lines로 말한다
// (L4.cli.plan C16, m2-plan CLI.4). stdout은 계약 전용이어야 하고, stdin EOF로 정상 종료(0)해야 한다.
// 컴파일 자체는 build-sidecar 레시피가 한다. 여기서는 소스 진입을 실제 프로세스로 돌린다.

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function newHome(): string {
  const root = mkdtempSync(join(tmpdir(), "xcli-host-"));
  chmodSync(root, 0o700);
  mkdirSync(join(root, "config"), { mode: 0o700 });
  homes.push(root);
  return root;
}

/** stdout에서 줄 n개가 올 때까지 읽는다. 나머지 출력은 프로세스가 끝나기 전에 비워 둔다 */
async function readLines(stream: ReadableStream<Uint8Array>, count: number): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    text += decoder.decode(chunk, { stream: true });
    if (text.split("\n").filter((line) => line.length > 0).length >= count) break;
  }
  return text;
}

function frame(id: string, method: string, params: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

test("host --stdio answers host.hello and settings.get over JSON Lines, then exits 0 on stdin EOF", async () => {
  const home = newHome();
  const proc = Bun.spawn([process.execPath, MAIN, "host", "--stdio"], {
    env: { ...process.env, XEON_HOME: home, XEON_DEV: "1" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.stdin.write(
    frame("r1", "host.hello", {
      protocolVersion: WIRE_PROTOCOL_VERSION,
      client: { name: "test", version: "0.0.0", kind: "other" },
    }),
  );
  await proc.stdin.write(frame("r2", "settings.get", { keys: ["l4.cli.theme"] }));
  await proc.stdin.flush();
  // 응답 둘을 받은 뒤에 EOF를 보낸다: EOF는 종료 절차를 시작시키므로 먼저 보내면 응답이 잘린다
  const out = await readLines(proc.stdout, 2);
  await proc.stdin.end();
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  expect(code, err).toBe(0);
  const lines = out.split("\n").filter((line) => line.length > 0);
  // stdout의 모든 줄이 JSON-RPC 메시지다: 사람용 출력이 섞이지 않는다
  const messages = lines.map((line) => {
    const decoded = parseJson(line);
    expect(decoded.ok, line).toBe(true);
    return decoded.ok ? decoded.value : null;
  });
  expect(messages).toHaveLength(2);
  expect(messages[0]).toMatchObject({ id: "r1", result: { transport: "stdio" } });
  // l4.cli.* 설정 그룹이 사이드카의 카탈로그에 들어 있다
  expect(messages[1]).toMatchObject({
    id: "r2",
    result: { settings: [{ key: "l4.cli.theme", value: "system" }] },
  });
}, 60_000);
