import { err, ok } from "@fresnel/contracts";
import type { ToolOutputFiles } from "@fresnel/contracts/services";

// 잘린 출력 사본 대역. 파일 시스템 대신 메모리에 둔다. 경로 꼴은 운영 구현과 같다(`<dir>/<thread>/<sha256>.txt`).

export interface FakeOutputFiles extends ToolOutputFiles {
  /** 경로 → 내용 */
  readonly files: Map<string, Uint8Array>;
  /** 쓰기가 이 종류로 실패하게 한다 */
  failWrites(on: boolean): void;
}

export function fakeOutputFiles(dir = "/fake/tool-output"): FakeOutputFiles {
  const files = new Map<string, Uint8Array>();
  let failing = false;
  const pathFor = (threadId: string, sha256: string): string => `${dir}/${threadId}/${sha256}.txt`;
  return {
    dir,
    files,
    failWrites: (on) => {
      failing = on;
    },
    pathFor,
    write(threadId, sha256, bytes) {
      if (failing) return Promise.resolve(err({ kind: "io", cause: new Error("write_failed") }));
      const path = pathFor(threadId, sha256);
      files.set(path, bytes);
      return Promise.resolve(ok(path));
    },
    restore: (path) => Promise.resolve(ok(files.has(path))),
    removeThread(threadId) {
      for (const path of files.keys()) {
        if (path.startsWith(`${dir}/${threadId}/`)) files.delete(path);
      }
      return Promise.resolve();
    },
    sweep: () => Promise.resolve(0),
  };
}
