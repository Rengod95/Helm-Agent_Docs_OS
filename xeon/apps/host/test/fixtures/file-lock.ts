import { createOsService, readOsRuntime, type FileLock } from "@xeon/platform-os";

// 실제 OS 파일 잠금(`OsServiceHandle.fileLock`). 호스트 둘이 같은 파일을 고치는 시험은 서로 다른 서비스 둘을 만들어 쓴다:
// 같은 서비스 안의 잠금은 프로세스 안 표로 먼저 판정하지만 서비스가 다르면 OS 잠금(flock)이 막는다.

export interface OpenedFileLock {
  readonly fileLock: FileLock;
  dispose(): Promise<void>;
}

export async function openFileLock(resourceDir: string): Promise<OpenedFileLock> {
  const started = await createOsService(
    { resourceDir, logSink: () => undefined, logRedact: (line) => line },
    readOsRuntime(),
  );
  if (!started.ok) throw new Error(`the os service could not start: ${started.error.kind}`);
  return { fileLock: started.value.fileLock, dispose: () => started.value.dispose() };
}
