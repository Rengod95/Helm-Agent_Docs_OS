import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseServiceEndpoint,
  type EndpointParseError,
  type ServiceEndpoint,
} from "@xeon/client/endpoint";
import { attemptAsync, parseJson } from "@xeon/contracts";
import { resolveOsDirs } from "@xeon/platform-os";
import { hostResourceDir } from "../state-paths.ts";

// L4.host-service.spec §3.6 resolveLaunchMode, HS-37. 엔진 없이 사용자 설정 파일만 읽어 `l0.process.service.enabled`를 해석한다.
// 데스크톱 셸과 CLI가 사이드카(in-process·stdio)와 서비스 중 어느 쪽으로 갈지 정할 때 쓴다. 관리 범위 파일은 읽지 않는다 [미결: managed 위치는 L0.os].

/** 사용자 설정 파일(`<config>/settings.json`, 평평한 객체)의 한 값을 엔진 없이 읽는다. 읽을 수 없으면 undefined */
async function readUserSetting(key: string): Promise<unknown> {
  const dirs = resolveOsDirs({ resourceDir: hostResourceDir() });
  if (!dirs.ok) return undefined;
  const text = await attemptAsync(() => readFile(join(dirs.value.config, "settings.json"), "utf8"));
  if (!text.ok) return undefined;
  const json = parseJson(text.value);
  if (!json.ok || typeof json.value !== "object" || json.value === null) return undefined;
  return Object.fromEntries(Object.entries(json.value))[key];
}

export async function resolveLaunchMode(): Promise<"in-process" | "service"> {
  return (await readUserSetting("l0.process.service.enabled")) === true ? "service" : "in-process";
}

export type RemoteResolution =
  /** 원격 주소가 없다. 평소대로 in-process나 이 기기의 서비스를 쓴다 */
  | { readonly kind: "none" }
  | {
      readonly kind: "remote";
      readonly endpoint: ServiceEndpoint;
      readonly from: "flag" | "setting";
    }
  /** 주소 문자열이 문법에 맞지 않는다. 조용히 로컬로 가지 않고 알린다 */
  | {
      readonly kind: "invalid";
      readonly text: string;
      readonly from: "flag" | "setting";
      readonly error: EndpointParseError;
    };

/** TCP 접속 토큰을 읽는 환경 변수. 설정 파일이나 argv에는 토큰을 두지 않는다 [결정: 오케스트레이터 기본값] */
export const REMOTE_TOKEN_ENV = "XEON_REMOTE_TOKEN";

/**
 * 원격 서비스 주소를 정한다. 우선순위는 `--remote` 플래그, 사용자 설정 `l0.process.service.remote`다(HS-37과 같이 엔진 없이 설정 파일만 읽는다).
 * tcp 주소의 토큰은 환경 변수 XEON_REMOTE_TOKEN에서 가져온다. 설정값이 빈 문자열이면 원격을 쓰지 않는다
 */
export async function resolveRemoteEndpoint(options: {
  readonly flag?: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}): Promise<RemoteResolution> {
  const fromFlag = options.flag !== undefined && options.flag !== "";
  const setting = fromFlag ? undefined : await readUserSetting("l0.process.service.remote");
  const text = fromFlag ? (options.flag ?? "") : typeof setting === "string" ? setting : "";
  if (text.trim() === "") return { kind: "none" };
  const from = fromFlag ? "flag" : "setting";
  const parsed = parseServiceEndpoint(text);
  if (!parsed.ok) return { kind: "invalid", text, from, error: parsed.error };
  const token = options.env[REMOTE_TOKEN_ENV];
  const endpoint =
    parsed.value.kind === "tcp" && token !== undefined && token !== ""
      ? { ...parsed.value, token }
      : parsed.value;
  return { kind: "remote", endpoint, from };
}
