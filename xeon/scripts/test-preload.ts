// bun test 전역 훅(각 패키지 bunfig.toml의 preload). 임시 파일이 쓰이는 시험의 scratch 디렉터리를 메모리 파일 시스템(/dev/shm)으로 옮긴다.
// SQLite WAL, blob, 임대 파일의 fsync가 디스크 위에서는 시험마다 0.1초 안팎이라 한 패키지가 수십 초를 fsync에 쓴다. 시험이 확인하는 것은
// 파일 형식, 잠금, 복구 불변식이지 디스크 내구성이 아니므로 파일, SQLite, 프로세스는 그대로 실제를 쓰고 쓰기 지연만 없앤다.
// 내구성 자체를 보는 시험은 `XEON_TEST_DISK_TMP=1`로 이 훅을 끄고 실제 디스크에서 돌린다. /dev/shm이 없으면(macOS 등) 아무것도 하지 않는다.
// 자식 프로세스는 바뀐 TMPDIR을 상속한다. 디렉터리는 시험 파일이 끝날 때 지운다.
import { afterAll, beforeAll } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const SHM = "/dev/shm";

function usableShm(): boolean {
  return statSync(SHM, { throwIfNoEntry: false })?.isDirectory() === true;
}

if (process.env["XEON_TEST_DISK_TMP"] !== "1" && usableShm()) {
  let scratch: string | undefined;
  beforeAll(() => {
    scratch = mkdtempSync(join(SHM, "xeon-test-"));
    process.env["TMPDIR"] = scratch;
  });
  // bun test는 프로세스 exit 이벤트를 내지 않으므로 파일마다 afterAll에서 지운다
  afterAll(() => {
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  });
}
