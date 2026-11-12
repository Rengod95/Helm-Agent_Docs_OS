import { basename } from "node:path";
import { err, ok, type Result } from "@fresnel/contracts";
import type { ProcessRunner, RunOutput, RunRequest } from "../../src/providers/process.ts";

// 가짜 키 저장소 어댑터. 메모리 한 칸에 identity를 두고, `security`(macOS)와 `secret-tool`(Linux)의 argv 모양만 흉내 낸다.
// 실제 키체인이나 Secret Service는 건드리지 않는다. 시험이 넘긴 실행기만 이 대역을 실행한다.
// 시험은 argv와 stdin 바이트를 검사할 수 있도록 요청을 모두 남긴다.

export interface FakeKeychainOptions {
  /** 처음 들어 있는 identity(시험이 만든 가짜 값). 없으면 빈 저장소 */
  readonly existing?: string;
  /** 추가(`-i`의 add, `secret-tool store`)가 실행 오류로 실패한다 */
  readonly failAdd?: boolean;
  /** 삭제(`delete-generic-password`, `secret-tool clear`)가 실패한다(종료 코드 2) */
  readonly failDelete?: boolean;
}

export interface FakeKeychain {
  readonly runner: ProcessRunner;
  readonly requests: readonly RunRequest[];
  /** 지금 저장된 identity. 없으면 null */
  stored(): string | null;
  /** 시험이 저장 상태를 직접 놓는다(같은 키를 두 곳에 두는 시험에 쓴다) */
  set(identity: string | null): void;
  /** 요청들의 stdin 버퍼. 호출이 끝난 뒤 호출자가 0으로 덮었는지 본다 */
  stdins(): Uint8Array[];
}

const EMPTY = new Uint8Array();
const EXIT_NOT_FOUND_SECURITY = 44;

function done(exitCode: number, stdout: Uint8Array = EMPTY): Result<RunOutput, never> {
  return ok({ exitCode, stdout, stderr: "" });
}

export function fakeKeychain(options: FakeKeychainOptions = {}): FakeKeychain {
  let item: string | null = options.existing ?? null;
  const requests: RunRequest[] = [];
  const stdins: Uint8Array[] = [];

  function securityCall(
    request: RunRequest,
  ): Promise<Result<RunOutput, { kind: "spawn_failed"; code: string }>> {
    const verb = request.argv[1];
    if (verb === "find-generic-password") {
      if (item === null) return Promise.resolve(done(EXIT_NOT_FOUND_SECURITY));
      // `-w`가 있으면 비밀번호를 stdout에 쓴다(줄바꿈을 붙인다)
      if (request.argv.includes("-w")) {
        return Promise.resolve(done(0, new TextEncoder().encode(`${item}\n`)));
      }
      return Promise.resolve(done(0));
    }
    if (verb === "-i" && request.stdin !== undefined) {
      stdins.push(request.stdin);
      if (options.failAdd === true) {
        return Promise.resolve(err({ kind: "spawn_failed", code: "EPERM" }));
      }
      const line = new TextDecoder().decode(request.stdin);
      const identity = /-w (AGE-SECRET-KEY-1[A-Z0-9]+)\n$/.exec(line)?.[1];
      if (identity !== undefined) item = identity;
      return Promise.resolve(done(0));
    }
    if (verb === "delete-generic-password") {
      if (options.failDelete === true) return Promise.resolve(done(2));
      const existed = item !== null;
      item = null;
      return Promise.resolve(done(existed ? 0 : EXIT_NOT_FOUND_SECURITY));
    }
    return Promise.resolve(done(2));
  }

  function toolCall(
    request: RunRequest,
  ): Promise<Result<RunOutput, { kind: "spawn_failed"; code: string }>> {
    const verb = request.argv[1];
    if (verb === "lookup") {
      if (item === null) return Promise.resolve(done(1));
      if (request.discardStdout === true) return Promise.resolve(done(0));
      return Promise.resolve(done(0, new TextEncoder().encode(item)));
    }
    if (verb === "store" && request.stdin !== undefined) {
      stdins.push(request.stdin);
      if (options.failAdd === true) {
        return Promise.resolve(err({ kind: "spawn_failed", code: "EPERM" }));
      }
      item = new TextDecoder().decode(request.stdin);
      return Promise.resolve(done(0));
    }
    if (verb === "clear") {
      if (options.failDelete === true) return Promise.resolve(done(1));
      item = null;
      return Promise.resolve(done(0));
    }
    return Promise.resolve(done(2));
  }

  const runner: ProcessRunner = (request) => {
    requests.push(request);
    const tool = basename(request.argv[0] ?? "");
    if (tool === "security") return securityCall(request);
    if (tool === "secret-tool") return toolCall(request);
    return Promise.resolve(done(127));
  };

  return {
    runner,
    requests,
    stored: () => item,
    set(identity) {
      item = identity;
    },
    stdins: () => stdins,
  };
}
