import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 시험이 실제 사용자 디렉터리(~/.config, ~/.local/share)를 건드리지 않게 XEON_HOME을 임시 디렉터리로 돌린다(L0.os.spec §3.2).
// 시험 파일 하나가 한 번에 하나의 엔진 홈만 쓴다(bun test는 파일 안의 시험을 차례로 실행한다).

export interface EngineHome {
  readonly root: string;
  readonly dataDir: string;
  dispose(): void;
}

export function useEngineHome(): EngineHome {
  const root = mkdtempSync(join(tmpdir(), "xh-"));
  const previous = process.env["XEON_HOME"];
  process.env["XEON_HOME"] = root;
  return {
    root,
    dataDir: join(root, "data"),
    dispose() {
      if (previous === undefined) delete process.env["XEON_HOME"];
      else process.env["XEON_HOME"] = previous;
      rmSync(root, { recursive: true, force: true });
    },
  };
}
