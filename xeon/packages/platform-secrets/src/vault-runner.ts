import { spawn } from "node:child_process";
import { err, ok } from "@fresnel/contracts";
import type { ProcessRunner } from "./providers/process.ts";

// Node(Electron 메인)용 `ProcessRunner`. Bun이 아닌 곳에서 보안 저장소 도구(`security`, `secret-tool`)를 부를 때 쓴다.
// 프로세스를 띄우는 일은 L0가 맡는다(DR-07). 값은 stdin으로만 가고 오류에는 코드만 싣는다.

export const nodeProcessRunner: ProcessRunner = (request) =>
  new Promise((resolve) => {
    const [file, ...args] = request.argv;
    if (file === undefined || request.signal.aborted) {
      resolve(err({ kind: "cancelled" }));
      return;
    }
    const child = spawn(file, args, {
      env: { ...request.env },
      stdio: [
        request.stdin === undefined ? "ignore" : "pipe",
        request.discardStdout === true ? "ignore" : "pipe",
        "pipe",
      ],
      timeout: request.timeoutMs,
      signal: request.signal,
    });
    const out: Uint8Array[] = [];
    let stderr = "";
    child.stdout?.on("data", (chunk: Uint8Array) => {
      out.push(chunk);
    });
    child.stderr?.on("data", (chunk: Uint8Array) => {
      stderr += new TextDecoder().decode(chunk);
    });
    child.once("error", (cause: Error) => {
      resolve(
        request.signal.aborted
          ? err({ kind: "cancelled" })
          : err({ kind: "spawn_failed", code: "code" in cause ? String(cause.code) : cause.name }),
      );
    });
    child.once("close", (code) => {
      if (request.signal.aborted) {
        resolve(err({ kind: "cancelled" }));
        return;
      }
      const stdout = new Uint8Array(out.reduce((size, part) => size + part.length, 0));
      let at = 0;
      for (const part of out) {
        stdout.set(part, at);
        at += part.length;
      }
      resolve(ok({ exitCode: code ?? -1, stdout, stderr }));
    });
    if (request.stdin !== undefined) child.stdin?.end(request.stdin);
  });
