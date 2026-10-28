import { assertNever, err, ok, type Result } from "@xeon/contracts";
import type { HostConnection } from "@xeon/contracts/wire";
import {
  binaryViewOf,
  DEFAULT_MODEL_KEY,
  defaultModelOf,
  PROVIDERS_KEY,
  providersOf,
  withProviderKey,
  type BinaryView,
  type KeyRegisterError,
  type SecretRow,
  type SetupSnapshot,
} from "@xeon/client/settings";
import type { DesktopIpc, SecretRegisterError } from "../transport/ipc.ts";
import type { CommandError, SetupCommands } from "../views/commands.ts";

// 최소 설정 화면이 부르는 wire(G2-08). 모델 키는 값 없는 `secret.*`로만 다루고(L0.secrets.spec R4),
// provider 설정에는 `secret://<이름>` 참조만 쓴다. 값은 이 화면, wire, 로그 어디에도 없다.

/**
 * 점검 없이 다시 읽은 설정(`load({ binaries: false })`)에 앞서 읽은 외부 도구 점검 결과를 이어 붙인다.
 * 설정이 바뀌어도 설치된 도구는 그대로라 점검을 되풀이하지 않는다(점검은 자식 프로세스를 띄운다, HS-69).
 */
export function keepTools(fresh: SetupSnapshot, previous: SetupSnapshot): SetupSnapshot {
  return { ...fresh, binaries: previous.binaries, toolsReady: previous.toolsReady };
}

type Run = <T>(
  work: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

/** 셸의 오류를 화면이 아는 오류로 바꾼다. 셸 내부 사정(`detail`, 잘못된 요청)은 화면에 올리지 않는다 */
function keyRegisterErrorOf(error: SecretRegisterError): KeyRegisterError {
  switch (error.kind) {
    case "unavailable":
    case "empty":
    case "too-large":
    case "busy":
    case "timeout":
      return { kind: error.kind };
    case "rejected":
      return { kind: "rejected", exitCode: error.exitCode, detail: error.detail };
    case "bad-request":
    case "unknown":
      return { kind: "failed" };
    default:
      return assertNever(error, "SecretRegisterError");
  }
}

/** 쓰기 범위는 사용자 설정 파일이다. 키 등록과 기본 모델은 대화마다 다르지 않다 */
const SCOPE = "user";

export function createSetupCommands(
  run: Run,
  onInvalidated: (listener: () => void) => () => void,
  ipc: Pick<DesktopIpc, "registerSecret">,
): SetupCommands {
  return {
    async load(options) {
      const settings = await run((c) =>
        c.request("settings.get", { keys: [DEFAULT_MODEL_KEY, PROVIDERS_KEY] }),
      );
      if (!settings.ok) return settings;
      const valueOf = (key: string): unknown =>
        settings.value.settings.find((s) => s.key === key)?.value;
      const secrets = await run((c) => c.request("secret.list", {}));
      const rows: readonly SecretRow[] | null = secrets.ok
        ? secrets.value.secrets.map((entry) => ({
            name: entry.name,
            registered: entry.status === "valid" || entry.status === "expiring",
          }))
        : null;
      // 외부 도구 점검은 바이너리마다 자식 프로세스를 띄우므로 요청한 쪽만 한다(HS-69). 읽지 못하거나 구형 호스트면 "받을 수 없음"이다
      let binaries: BinaryView | null = null;
      if (options.binaries) {
        const status = await run((c) => c.request("host.status", { includeBinaries: true }));
        binaries = status.ok ? binaryViewOf(status.value.binaries) : null;
      }
      const snapshot: SetupSnapshot = {
        providers: providersOf(valueOf(PROVIDERS_KEY)),
        defaultModel: defaultModelOf(valueOf(DEFAULT_MODEL_KEY)),
        secrets: rows,
        toolsReady: binaries === null ? null : binaries.ready,
        binaries,
      };
      return ok(snapshot);
    },
    async beginKeyEntry(name, action) {
      const begun = await run((c) => c.request("secret.beginEntry", { name, action }));
      return begun.ok ? ok(begun.value.started) : begun;
    },
    async registerKey(name, action, value) {
      const registered = await ipc.registerSecret(name, action, value);
      return registered.ok ? ok(null) : err(keyRegisterErrorOf(registered.error));
    },
    async connectProviderKey(providerId, secretName) {
      // 목록 전체를 한 키로 쓰므로(병합 단위는 키 하나) 현재 값을 읽어 원소만 바꾼 목록을 보낸다
      const current = await run((c) => c.request("settings.get", { keys: [PROVIDERS_KEY] }));
      if (!current.ok) return current;
      const providers = withProviderKey(
        providersOf(current.value.settings[0]?.value),
        providerId,
        secretName,
      );
      const written = await run((c) =>
        c.request("settings.set", { key: PROVIDERS_KEY, value: providers, scope: SCOPE }),
      );
      return written.ok ? ok(null) : written;
    },
    async setDefaultModel(ref) {
      const written = await run((c) =>
        c.request("settings.set", { key: DEFAULT_MODEL_KEY, value: ref, scope: SCOPE }),
      );
      return written.ok ? ok(null) : written;
    },
    onInvalidated,
  };
}
