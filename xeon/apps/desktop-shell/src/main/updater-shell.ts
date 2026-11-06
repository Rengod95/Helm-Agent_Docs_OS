// electron과 electron-updater를 잇는 어댑터(B-10). 설정 파일(`ctx.paths.resources`의 `update-feed.json`)을 읽어 설정 여부를 정하고,
// 설정됐을 때만 electron-updater를 동적으로 불러온다. 설정이 없으면 electron-updater는 적재되지 않는다.
// 서명 검증은 electron-updater가 한다. 검증이 실패하면 설치하지 않는다. 이 파일에는 검증을 건너뛰는 길이 없다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { attempt } from "@fresnel/contracts";
import { app } from "electron";
import type { AppUpdater, ProgressInfo, UpdateInfo } from "electron-updater";
import type { ShellModule } from "./context.ts";
import { appLogOf } from "./lib/applog.ts";
import {
  createUpdaterModule,
  feedFromText,
  type UpdateCandidate,
  type UpdateFeed,
  type UpdaterBackend,
} from "./updater.ts";

/** 설정 파일 이름. `ctx.paths.resources` 아래에 둔다. 저장소에는 두지 않는다(배포 주소는 사용자가 채운다) */
const FEED_FILE = "update-feed.json";

/** 설정이 있을 때 electron-updater를 불러와 피드를 맞춘다. 자동 내려받기와 종료 때 자동 설치는 끈다 */
async function loadUpdater(feed: UpdateFeed): Promise<AppUpdater> {
  const mod = await import("electron-updater");
  // CJS 모듈의 이름 붙은 내보내기는 ESM 적재기가 정적으로 못 찾을 수 있어 `default`로 읽는다
  const updater = mod.default.autoUpdater;
  updater.setFeedURL({ provider: "generic", url: feed.url });
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  return updater;
}

/** 설정된 앱의 백엔드. electron-updater는 처음 쓸 때 불러온다. 내려받기는 확인 뒤에만 가능하므로 설치 때는 이미 불러와 있다 */
function electronBackend(feed: UpdateFeed): UpdaterBackend {
  let loaded: AppUpdater | null = null;
  const ready = async (): Promise<AppUpdater> => {
    const updater = loaded ?? (await loadUpdater(feed));
    loaded = updater;
    return updater;
  };
  return {
    async checkForUpdates(): Promise<UpdateCandidate | null> {
      const updater = await ready();
      // 패키지 앱이 아니면 electron-updater는 확인하지 않고 null을 준다. 그것을 "최신"으로 읽지 않도록 실패로 던진다
      if (!updater.isUpdaterActive()) throw new Error("updater inactive: app is not packaged");
      const result = await updater.checkForUpdates();
      if (result === null || !result.isUpdateAvailable) return null;
      return {
        version: result.updateInfo.version,
        notes: notesOf(result.updateInfo.releaseNotes),
      };
    },
    async download(onProgress): Promise<void> {
      const updater = await ready();
      // electron-updater의 `transferred`는 누적 바이트라 그대로 넘긴다
      const onDownload = (info: ProgressInfo): void => {
        onProgress(info.transferred, info.total);
      };
      updater.on("download-progress", onDownload);
      try {
        await updater.downloadUpdate();
      } finally {
        updater.off("download-progress", onDownload);
      }
    },
    quitAndInstall(): void {
      // 내려받기 전에는 불리지 않는다(모듈이 막는다). 그래도 불리면 설치하지 않고 실패로 돌린다
      if (loaded === null) throw new Error("updater is not loaded");
      loaded.quitAndInstall();
    },
  };
}

/** 설정이 없을 때의 백엔드. 모듈이 설정 여부로 막으므로 불리지 않는다. 불려도 electron-updater에 닿지 않는다 */
const UNCONFIGURED_BACKEND: UpdaterBackend = {
  checkForUpdates: () => Promise.reject(new Error("updater is not configured")),
  download: () => Promise.reject(new Error("updater is not configured")),
  quitAndInstall: () => {
    throw new Error("updater is not configured");
  },
};

/** 바뀐 점. 글이면 그대로, 항목 목록이면 각 항목의 글을 줄바꿈으로 잇는다. 없으면 `null` */
function notesOf(notes: UpdateInfo["releaseNotes"]): string | null {
  if (typeof notes === "string") return notes;
  if (!Array.isArray(notes)) return null;
  const text = notes
    .map((item) => item.note ?? "")
    .filter((line) => line.trim() !== "")
    .join("\n");
  return text === "" ? null : text;
}

/** 설정 파일을 읽는다. 없으면 설정이 안 된 것이라 조용히 넘어간다. 있는데 못 읽거나 쓸 수 없으면 로그에 이유만 남긴다 */
function readFeed(resources: string, log: (line: string) => void): UpdateFeed | null {
  const read = attempt(() => readFileSync(path.join(resources, FEED_FILE), "utf8"));
  if (!read.ok) {
    if (!isMissing(read.error.cause)) log("updater: feed file unreadable (reason: read_failed)");
    return null;
  }
  const feed = feedFromText(read.value);
  if (feed === null) log("updater: feed file is not usable (reason: invalid_feed)");
  return feed;
}

/** 파일이 없는 오류인가 */
function isMissing(cause: unknown): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

/** 업데이트 모듈의 셸 쪽 진입점. `modules.ts`의 목록에 넣는다 */
export const updaterShellModule: ShellModule = {
  name: "updater",
  register(ctx) {
    const appLog = appLogOf(ctx);
    const log = (line: string): void => {
      appLog.line(line);
    };
    const feed = readFeed(ctx.paths.resources, log);
    createUpdaterModule({
      backend: feed === null ? UNCONFIGURED_BACKEND : electronBackend(feed),
      configured: feed !== null,
      currentVersion: app.getVersion(),
      log,
    }).register(ctx);
  },
};
