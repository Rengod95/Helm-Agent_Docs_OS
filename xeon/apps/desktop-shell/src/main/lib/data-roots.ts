// 셸이 쓰는 데이터 폴더 셋(설정 폴더, Electron userData, 앱 로그)을 정한다.
// 기본은 OS 위치(`<appData>/dev.fresnel.desktop`, `<appData>/dev.fresnel.desktop.electron`, macOS `~/Library/Logs/...`)다.
// 환경 변수 `FRESNEL_DESKTOP_USER_DATA`가 절대 경로이면 개발·시험용으로 그 폴더 하나 안에 셋을 모은다
// (`config/`, `electron/`, `logs/`). 묶은 앱에서도 읽는다. 실제 Library를 건드리지 않고 앱을 띄우는 길이다.
import path from "node:path";

/** 데이터 폴더를 한 폴더로 모으는 환경 변수 이름 */
export const USER_DATA_ENV = "FRESNEL_DESKTOP_USER_DATA";

export interface DataRoots {
  /** 설정 폴더(`desktop-settings.json`, 창 위치) */
  readonly configDir: string;
  /** Electron userData(캐시, 세션, 단일 인스턴스 잠금) */
  readonly userData: string;
  /** 앱 로그 폴더 */
  readonly logs: string;
}

export interface DataRootInputs {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  /** Electron `app.getPath("appData")` */
  readonly appData: string;
  /** Electron `app.getPath("home")` */
  readonly home: string;
  readonly identifier: string;
}

/** 환경 변수가 없거나 비었거나 절대 경로가 아니면 OS 기본을 돌려준다 */
export function dataRootsOf(input: DataRootInputs): DataRoots {
  const override = input.env[USER_DATA_ENV];
  if (override !== undefined && override !== "" && path.isAbsolute(override)) {
    const root = path.normalize(override);
    return {
      configDir: path.join(root, "config"),
      userData: path.join(root, "electron"),
      logs: path.join(root, "logs"),
    };
  }
  const userData = path.join(input.appData, `${input.identifier}.electron`);
  return {
    configDir: path.join(input.appData, input.identifier),
    userData,
    logs:
      input.platform === "darwin"
        ? path.join(input.home, "Library", "Logs", input.identifier)
        : path.join(userData, "logs"),
  };
}
