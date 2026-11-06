// 묶은 앱(`app.isPackaged`)이 읽는 환경 변수. 개발용 변수는 묶은 앱에서 지운다.
// 사용자의 셸 환경에 `FRESNEL_DESKTOP_INSPECT=1`이 남아 있어도 묶은 앱은 inspect 소켓을 열지 않고,
// 엔진 바이너리와 화면 번들도 Resources 것만 쓴다(L4.desktop.spec §11).
import { INSPECT_ENV, INSPECT_SOCKET_ENV } from "../inspect.ts";

/** 개발에서만 읽는 환경 변수 이름. 묶은 앱의 `ctx.env`에서 빠진다 */
export const DEV_ONLY_ENV: readonly string[] = [
  INSPECT_ENV,
  INSPECT_SOCKET_ENV,
  "FRESNEL_DESKTOP_ENGINE_BIN",
  "FRESNEL_DESKTOP_ENGINE_ARGS",
  "FRESNEL_UI_DIR",
];

/** 묶은 앱이면 개발용 변수를 뺀 사본을, 아니면 받은 환경을 그대로 돌려준다 */
export function shellEnvOf(env: NodeJS.ProcessEnv, packaged: boolean): NodeJS.ProcessEnv {
  if (!packaged) return env;
  const kept: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!DEV_ONLY_ENV.includes(key)) kept[key] = value;
  }
  return kept;
}
