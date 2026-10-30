import { dirname } from "node:path";
import { attemptAsync, type Logger } from "@xeon/contracts";
import type { OsService } from "@xeon/contracts/services";
import { messageOf } from "../util.ts";

// M3-REQ-49(M3-new-08). 사용자 설정 파일을 L0.os의 `watch`로 지켜보다가 다른 프로세스(CLI의 `xeon config set`, 다른 호스트, 사람이 연 편집기)가
// 바꾸면 메모리 층을 다시 읽고 `settings.invalidated`를 보낸다. 감시는 설정 디렉터리 하나를 열고, 그 안에서 설정 파일의 변경만 본다.
// 우리 자신의 쓰기도 변경으로 오지만 다시 읽은 값이 메모리와 같으면 알리지 않는다(`refreshUserFile`이 값 차이로 정한다). 조립 루트 코드(DR-14 예외 2).

export interface SettingsWatchDeps {
  readonly os: Pick<OsService, "watch">;
  /** 사용자 설정 파일의 경로. 이 경로의 변경만 본다 */
  readonly userPath: string;
  /** 사용자 설정 파일을 다시 읽어 반영하고 알린다(`SettingsStorePort.refreshUserFile`) */
  readonly refresh: () => Promise<void>;
  readonly logger: Logger;
}

export interface SettingsWatch {
  close(): Promise<void>;
}

/** 감시를 연다. 감시를 열 수 없으면(허용 밖 경로, 백엔드 없음) 경고만 남기고 감시 없이 돌아간다 */
export async function watchUserSettings(deps: SettingsWatchDeps): Promise<SettingsWatch> {
  const { os, userPath, refresh, logger } = deps;
  // 다시 읽기는 차례로 한다: 변경이 연달아 와도 앞 읽기가 끝나야 다음을 시작한다
  const chain: { tail: Promise<void> } = { tail: Promise.resolve() };
  const refreshOnce = async (): Promise<void> => {
    const done = await attemptAsync(refresh);
    if (!done.ok) logger.warn("settings.refresh_failed", { message: messageOf(done.error.cause) });
  };
  const opened = await os.watch(dirname(userPath), {}, (changes) => {
    if (!changes.some((change) => change.path === userPath)) return;
    chain.tail = chain.tail.then(refreshOnce);
  });
  if (!opened.ok) {
    logger.warn("settings.watch_failed", { path: dirname(userPath), kind: opened.error.kind });
    return { close: () => Promise.resolve() };
  }
  const handle = opened.value;
  return {
    async close() {
      await handle.close();
      await chain.tail;
    },
  };
}
