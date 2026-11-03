import { join } from "node:path";
import { createOsService, readOsRuntime, type FileLock } from "@fresnel/platform-os";

// 실제 OS 파일 잠금(`OsServiceHandle.fileLock`). 호스트 둘이 같은 파일을 고치는 시험은 서로 다른 서비스 둘을 만들어 쓴다:
// 같은 서비스 안의 잠금은 프로세스 안 표로 먼저 판정하지만 서비스가 다르면 OS 잠금(flock)이 막는다.

export interface OpenedFileLock {
  readonly fileLock: FileLock;
  dispose(): Promise<void>;
}

export async function openFileLock(resourceDir: string): Promise<OpenedFileLock> {
  // 기기의 실제 폴더(홈, /tmp/fresnel-<uid>)를 읽지 않게 모든 폴더를 시험 폴더 아래로 둔다. 다른 시험이 같은 폴더를 넓은 권한으로 먼저 만들면 시작이 실패한다
  const runtime = readOsRuntime();
  const started = await createOsService(
    {
      resourceDir,
      dirsOverride: join(resourceDir, "home"),
      logSink: () => undefined,
      logRedact: (line) => line,
    },
    {
      ...runtime,
      systemTmp: resourceDir,
      env: { ...runtime.env, XDG_RUNTIME_DIR: join(resourceDir, "run") },
    },
  );
  if (!started.ok)
    throw new Error(`the os service could not start: ${JSON.stringify(started.error)}`);
  return { fileLock: started.value.fileLock, dispose: () => started.value.dispose() };
}
