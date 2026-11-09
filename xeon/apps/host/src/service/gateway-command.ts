// 웹 게이트웨이 실행 파일 찾기와 자식 환경. 순수 함수다. 파일 존재는 `exists`로만 보고, OS 이름은 읽지 않는다(시험이 값을 바꿔 부른다).
import path from "node:path";
import { err, ok, type Result } from "@fresnel/contracts";

/** 게이트웨이 실행 파일을 직접 지정하는 환경 변수(절대 경로 실행 파일) */
const GATEWAY_BIN_ENV: string = "FRESNEL_WEB_BIN";
/** 게이트웨이에 넘길 UI 폴더 환경 변수(절대 경로). 없으면 `--ui`를 넘기지 않아 게이트웨이 기본값을 쓴다 */
const GATEWAY_UI_ENV: string = "FRESNEL_WEB_UI";

const GATEWAY_NAME = "fresnel-web";
/** 서비스 소스 폴더(`apps/host/src/service`)에서 본 개발 트리의 게이트웨이 진입점 */
const DEV_MAIN_RELATIVE = "../../../desktop-shell/src/web/main.ts";
const BUN_RUNTIME = /^bun(?:\.exe)?$/iu;
/** 자식에게 옮기는 부모 환경 이름. 나머지는 버린다(부모 환경 상속 금지) */
const INHERITED_ENV: readonly string[] = [
  "PATH",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "SHELL",
];
/** `FRESNEL_` 접두 이름이라도 비밀로 보이면 옮기지 않는다 */
const SECRET_NAME = /TOKEN|SECRET|PASS|KEY|CREDENTIAL/iu;

interface GatewayCommandError {
  readonly kind: "gateway-binary-missing";
  readonly message: string;
}

export type GatewayEnv = Readonly<Record<string, string | undefined>>;

function missing(message: string): Result<never, GatewayCommandError> {
  return err({ kind: "gateway-binary-missing", message });
}

/**
 * 게이트웨이를 띄울 명령을 고른다. 순서는 (1) `FRESNEL_WEB_BIN`, (2) 실행 중인 호스트 바이너리 옆의 `fresnel-web`(Windows는 `.exe`),
 * (3) 호스트가 bun으로 도는 개발 트리의 `desktop-shell/src/web/main.ts`(bun run으로 띄운다)다. 어디에도 없으면 환경 문제 오류다.
 * `serviceDir`는 호스트 서비스 소스 폴더다.
 */
export function resolveGatewayCommand(
  env: GatewayEnv,
  execPath: string,
  serviceDir: string,
  exists: (file: string) => boolean,
): Result<{ readonly command: readonly [string, ...string[]] }, GatewayCommandError> {
  const override = env[GATEWAY_BIN_ENV];
  if (override !== undefined && override !== "") {
    if (!path.isAbsolute(override)) {
      return missing(`${GATEWAY_BIN_ENV} must be an absolute path to the web gateway program`);
    }
    if (!exists(override)) {
      return missing(`${GATEWAY_BIN_ENV} does not point to an existing file`);
    }
    const command: readonly [string] = [override];
    return ok({ command });
  }
  const suffix = path.extname(execPath).toLowerCase() === ".exe" ? ".exe" : "";
  const sibling = path.join(path.dirname(execPath), `${GATEWAY_NAME}${suffix}`);
  if (exists(sibling)) {
    const command: readonly [string] = [sibling];
    return ok({ command });
  }
  const devMain = path.resolve(serviceDir, DEV_MAIN_RELATIVE);
  if (BUN_RUNTIME.test(path.basename(execPath)) && exists(devMain)) {
    const command: readonly [string, string, string] = [execPath, "run", devMain];
    return ok({ command });
  }
  return missing(
    `the web gateway program (${GATEWAY_NAME}) was not found next to this program or in the development tree; ` +
      `this is an environment problem, not a code fault. Set ${GATEWAY_BIN_ENV} to its absolute path`,
  );
}

/** `FRESNEL_WEB_UI`가 있으면 `--ui`로 넘기는 인자. 없으면 빈 목록 */
export function uiArgsOf(env: GatewayEnv): string[] {
  const ui = env[GATEWAY_UI_ENV];
  return ui === undefined || ui === "" ? [] : ["--ui", ui];
}

/** 게이트웨이 자식의 환경: 허용 목록 이름과 `HOME`, 그리고 비밀이 아닌 `FRESNEL_*`만 옮긴다 */
export function childEnvOf(env: GatewayEnv, home: string): Record<string, string> {
  const out: Record<string, string> = { HOME: home };
  for (const name of INHERITED_ENV) {
    const value = env[name];
    if (value !== undefined) out[name] = value;
  }
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && name.startsWith("FRESNEL_") && !SECRET_NAME.test(name)) {
      out[name] = value;
    }
  }
  return out;
}
