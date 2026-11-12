import type { MessageId } from "../i18n/index.ts";
import { parseTargetAddress } from "./address.ts";

// 사전 점검과 원격 붙기 명령의 번역 키(L4.remote.spec §3.3). 셸은 단계, 원인 코드, 값만 준다. 사람이 읽는 문장은 여기서
// 키를 고르고 화면이 번역한다. 셸의 코드는 snake_case이고 키 조각은 catalog 규칙(카멜 케이스)에 맞춘다.
// 코드마다 키를 표로 적어 두어, en.json에 없는 키는 타입 검사가 실패한다(test/connection-targets/preflight.test.ts가 값을 확인한다).

/** 사전 점검 단계(셸 `ssh_preflight`의 `step`). 연결 시험(`tunnel`)까지 여섯 단계다 */
export const PREFLIGHT_STEPS = [
  "resolve",
  "connect",
  "install",
  "service",
  "socket",
  "tunnel",
] as const;
export type PreflightStepId = (typeof PREFLIGHT_STEPS)[number];

/** 원인 코드. 각 코드는 `cause`와 `fix` 문장을 가진다. 셸이 이 밖의 코드를 주면 `unknown` 문장을 쓴다 */
export const PREFLIGHT_CAUSE_CODES = [
  "invalid_target",
  "invalid_port",
  "ssh_missing",
  "timeout",
  "dns",
  "refused",
  "no_route",
  "unknown",
  "auth_denied",
  "auth_password_only",
  "host_key_new",
  "host_key_changed",
  "host_key_proxy",
  "host_key_scan_failed",
  "host_key_mismatch_scan",
  "host_key_unresolved",
  "known_hosts_write_failed",
  "known_hosts_remove_failed",
  "not_installed",
  "version_unreadable",
  "version_mismatch",
  "service_status_unreadable",
  "service_start_failed",
  "service_not_running",
  "socket_unreadable",
  "tunnel_failed",
  "hello_failed",
  "auth_failed",
  "protocol_mismatch",
  "socket_missing",
  "host_key",
] as const;
export type PreflightCauseCode = (typeof PREFLIGHT_CAUSE_CODES)[number];

/** 조치 단추(`actions`). 모르는 것은 `retry`로 바꾼다 */
export type PreflightActionId =
  | "trust_host_key"
  | "replace_host_key"
  | "copy_command"
  | "upgrade_remote"
  | "upgrade_local"
  | "retry";

/** 고침 힌트(`fix.hint`). 모르는 것은 힌트 없이 보인다 */
export type PreflightHintId =
  | "path_noninteractive"
  | "upgrade_remote"
  | "upgrade_local"
  | "run_once_in_terminal";

/** 쌍 맺기(`remote_pair`)의 닫힌 오류 종류. 셸이 주는 `code`가 여기에 있다 */
export type PairErrorKind =
  | "fingerprint_changed"
  | "invalid_code"
  | "locked"
  | "invalid_device_name"
  | "rejected"
  | "bad_response"
  | "refused"
  | "timeout"
  | "io"
  | "vault_failed"
  | "invalid_input";

const CAUSE_KEYS: Readonly<Record<PreflightCauseCode, MessageId>> = {
  invalid_target: "desktop.connection.preflight.cause.invalidTarget",
  invalid_port: "desktop.connection.preflight.cause.invalidPort",
  ssh_missing: "desktop.connection.preflight.cause.sshMissing",
  timeout: "desktop.connection.preflight.cause.timeout",
  dns: "desktop.connection.preflight.cause.dns",
  refused: "desktop.connection.preflight.cause.refused",
  no_route: "desktop.connection.preflight.cause.noRoute",
  unknown: "desktop.connection.preflight.cause.unknown",
  auth_denied: "desktop.connection.preflight.cause.authDenied",
  auth_password_only: "desktop.connection.preflight.cause.authPasswordOnly",
  host_key_new: "desktop.connection.preflight.cause.hostKeyNew",
  host_key_changed: "desktop.connection.preflight.cause.hostKeyChanged",
  host_key_proxy: "desktop.connection.preflight.cause.hostKeyProxy",
  host_key_scan_failed: "desktop.connection.preflight.cause.hostKeyScanFailed",
  host_key_mismatch_scan: "desktop.connection.preflight.cause.hostKeyMismatchScan",
  host_key_unresolved: "desktop.connection.preflight.cause.hostKeyUnresolved",
  known_hosts_write_failed: "desktop.connection.preflight.cause.knownHostsWriteFailed",
  known_hosts_remove_failed: "desktop.connection.preflight.cause.knownHostsRemoveFailed",
  not_installed: "desktop.connection.preflight.cause.notInstalled",
  version_unreadable: "desktop.connection.preflight.cause.versionUnreadable",
  version_mismatch: "desktop.connection.preflight.cause.versionMismatch",
  service_status_unreadable: "desktop.connection.preflight.cause.serviceStatusUnreadable",
  service_start_failed: "desktop.connection.preflight.cause.serviceStartFailed",
  service_not_running: "desktop.connection.preflight.cause.serviceNotRunning",
  socket_unreadable: "desktop.connection.preflight.cause.socketUnreadable",
  tunnel_failed: "desktop.connection.preflight.cause.tunnelFailed",
  hello_failed: "desktop.connection.preflight.cause.helloFailed",
  auth_failed: "desktop.connection.preflight.cause.authFailed",
  protocol_mismatch: "desktop.connection.preflight.cause.protocolMismatch",
  socket_missing: "desktop.connection.preflight.cause.socketMissing",
  host_key: "desktop.connection.preflight.cause.hostKey",
};

const FIX_KEYS: Readonly<Record<PreflightCauseCode, MessageId>> = {
  invalid_target: "desktop.connection.preflight.fix.invalidTarget",
  invalid_port: "desktop.connection.preflight.fix.invalidPort",
  ssh_missing: "desktop.connection.preflight.fix.sshMissing",
  timeout: "desktop.connection.preflight.fix.timeout",
  dns: "desktop.connection.preflight.fix.dns",
  refused: "desktop.connection.preflight.fix.refused",
  no_route: "desktop.connection.preflight.fix.noRoute",
  unknown: "desktop.connection.preflight.fix.unknown",
  auth_denied: "desktop.connection.preflight.fix.authDenied",
  auth_password_only: "desktop.connection.preflight.fix.authPasswordOnly",
  host_key_new: "desktop.connection.preflight.fix.hostKeyNew",
  host_key_changed: "desktop.connection.preflight.fix.hostKeyChanged",
  host_key_proxy: "desktop.connection.preflight.fix.hostKeyProxy",
  host_key_scan_failed: "desktop.connection.preflight.fix.hostKeyScanFailed",
  host_key_mismatch_scan: "desktop.connection.preflight.fix.hostKeyMismatchScan",
  host_key_unresolved: "desktop.connection.preflight.fix.hostKeyUnresolved",
  known_hosts_write_failed: "desktop.connection.preflight.fix.knownHostsWriteFailed",
  known_hosts_remove_failed: "desktop.connection.preflight.fix.knownHostsRemoveFailed",
  not_installed: "desktop.connection.preflight.fix.notInstalled",
  version_unreadable: "desktop.connection.preflight.fix.versionUnreadable",
  version_mismatch: "desktop.connection.preflight.fix.versionMismatch",
  service_status_unreadable: "desktop.connection.preflight.fix.serviceStatusUnreadable",
  service_start_failed: "desktop.connection.preflight.fix.serviceStartFailed",
  service_not_running: "desktop.connection.preflight.fix.serviceNotRunning",
  socket_unreadable: "desktop.connection.preflight.fix.socketUnreadable",
  tunnel_failed: "desktop.connection.preflight.fix.tunnelFailed",
  hello_failed: "desktop.connection.preflight.fix.helloFailed",
  auth_failed: "desktop.connection.preflight.fix.authFailed",
  protocol_mismatch: "desktop.connection.preflight.fix.protocolMismatch",
  socket_missing: "desktop.connection.preflight.fix.socketMissing",
  host_key: "desktop.connection.preflight.fix.hostKey",
};

const ACTION_KEYS: Readonly<Record<PreflightActionId, MessageId>> = {
  trust_host_key: "desktop.connection.preflight.action.trustHostKey",
  replace_host_key: "desktop.connection.preflight.action.replaceHostKey",
  copy_command: "desktop.connection.preflight.action.copyCommand",
  upgrade_remote: "desktop.connection.preflight.action.upgradeRemote",
  upgrade_local: "desktop.connection.preflight.action.upgradeLocal",
  retry: "desktop.connection.preflight.action.retry",
};

const HINT_KEYS: Readonly<Record<PreflightHintId, MessageId>> = {
  path_noninteractive: "desktop.connection.preflight.hint.pathNoninteractive",
  upgrade_remote: "desktop.connection.preflight.hint.upgradeRemote",
  upgrade_local: "desktop.connection.preflight.hint.upgradeLocal",
  run_once_in_terminal: "desktop.connection.preflight.hint.runOnceInTerminal",
};

const PAIR_ERROR_KEYS: Readonly<Record<PairErrorKind, MessageId>> = {
  fingerprint_changed: "desktop.connection.pair.error.fingerprintChanged",
  invalid_code: "desktop.connection.pair.error.invalidCode",
  locked: "desktop.connection.pair.error.locked",
  invalid_device_name: "desktop.connection.pair.error.invalidDeviceName",
  rejected: "desktop.connection.pair.error.rejected",
  bad_response: "desktop.connection.pair.error.badResponse",
  refused: "desktop.connection.pair.error.refused",
  timeout: "desktop.connection.pair.error.timeout",
  io: "desktop.connection.pair.error.io",
  vault_failed: "desktop.connection.pair.error.vaultFailed",
  invalid_input: "desktop.connection.pair.error.invalidInput",
};

/** 입력 검사에서 걸린 쌍 맺기 코드. 화면은 이것들을 `invalid_input` 한 문장으로 묶는다 */
const PAIR_INPUT_CODES: readonly string[] = [
  "invalid_pin",
  "invalid_host",
  "invalid_port",
  "invalid_code_format",
];

function isKeyOf<K extends string>(table: Readonly<Record<K, unknown>>, value: string): value is K {
  return Object.hasOwn(table, value);
}

/** 단계의 이름 문장 키 */
export function preflightStepKey(
  step: PreflightStepId,
): `desktop.connection.preflight.step.${PreflightStepId}` {
  return `desktop.connection.preflight.step.${step}`;
}

/** 단계가 통과했을 때 한 줄 문장 키 */
export function preflightOkKey(
  step: PreflightStepId,
): `desktop.connection.preflight.ok.${PreflightStepId}` {
  return `desktop.connection.preflight.ok.${step}`;
}

/** 원인 문장 키. 모르는 코드는 `cause.unknown`이다 */
export function preflightCauseKey(code: string): MessageId {
  return isKeyOf(CAUSE_KEYS, code) ? CAUSE_KEYS[code] : CAUSE_KEYS.unknown;
}

/** 고치는 법 문장 키. 모르는 코드는 `fix.unknown`이다 */
export function preflightFixKey(code: string): MessageId {
  return isKeyOf(FIX_KEYS, code) ? FIX_KEYS[code] : FIX_KEYS.unknown;
}

/** 조치 단추의 이름 키. 모르는 조치는 `retry`다 */
export function preflightActionKey(action: string): MessageId {
  return isKeyOf(ACTION_KEYS, action) ? ACTION_KEYS[action] : ACTION_KEYS.retry;
}

/** 고침 힌트 문장 키. 모르는 힌트는 `null`이다(힌트 없이 보인다) */
export function preflightHintKey(hint: string): MessageId | null {
  return isKeyOf(HINT_KEYS, hint) ? HINT_KEYS[hint] : null;
}

/** 쌍 맺기 오류 문장 키. 입력 검사 코드는 `invalid_input`, 모르는 코드는 `io`다 */
export function pairErrorKey(code: string): MessageId {
  if (isKeyOf(PAIR_ERROR_KEYS, code)) return PAIR_ERROR_KEYS[code];
  if (PAIR_INPUT_CODES.some((known) => known === code)) return PAIR_ERROR_KEYS.invalid_input;
  return PAIR_ERROR_KEYS.io;
}

/** 마지막 대상을 적는 로컬 설정 키. 셸이 쓰기를 허용하는 접두사(`l4.desktop.window.`) 안에 있다 */
export const LAST_TARGET_KEY = "l4.desktop.window.lastTarget";

/**
 * 저장된 마지막 대상 값을 읽는다. 빈 문자열은 "이 컴퓨터"라 `null`이다. 문자열이 아니거나 주소 문법에 맞지 않으면 `null`이다.
 */
export function lastTargetOf(value: unknown): { readonly address: string } | null {
  if (typeof value !== "string") return null;
  const address = value.trim();
  if (address === "") return null;
  return parseTargetAddress(address).ok ? { address } : null;
}

/**
 * `ssh://[user@]host[:port]/<소켓>` 주소에서 사전 점검에 넘길 `[user@]host[:port]`를 만든다. ssh 주소가 아니면 `null`이다.
 */
export function sshTargetOfAddress(address: string): string | null {
  const parsed = parseTargetAddress(address);
  if (!parsed.ok || parsed.target.kind !== "ssh") return null;
  const { user, host, port } = parsed.target;
  const who = user === null ? "" : `${user}@`;
  const where = port === null ? "" : `:${String(port)}`;
  return `${who}${host}${where}`;
}
