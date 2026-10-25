import { ok, type Result } from "@xeon/contracts";
import type { HostConnection } from "@xeon/contracts/wire";
import {
  binaryViewOf,
  DEFAULT_MODEL_KEY,
  defaultModelOf,
  PROVIDERS_KEY,
  providersOf,
  withProviderKey,
  type BinaryView,
  type SecretRow,
  type SetupInput,
} from "../settings/index.ts";
import type { CommandError, SetupCommands } from "../views/commands.ts";

// 최소 설정 화면이 부르는 wire(G2-08). 모델 키는 값 없는 `secret.*`로만 다루고(L0.secrets.spec R4),
// provider 설정에는 `secret://<이름>` 참조만 쓴다. 값은 이 화면, wire, 로그 어디에도 없다.

export type SetupSnapshot = SetupInput & { readonly binaries: BinaryView | null };

/**
 * 외부 바이너리 점검 보고서의 원천(G2-07). wire에는 이 보고서를 싣는 메서드가 없고(`host.status` 결과는 키를 더 허용하지 않는다)
 * `host.diagnose`는 반려되었다. 그래서 원천은 주입한다: 값은 platform-os `BinaryCheckReport`의 JSON 모양이고, 모양이 다르면
 * "받을 수 없음"이다. 원천이 없으면(기본) 화면은 `xeon doctor` 안내를 보인다.
 */
export type BinaryReportSource = () => Promise<unknown>;

type Run = <T>(
  work: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

/** 쓰기 범위는 사용자 설정 파일이다. 키 등록과 기본 모델은 대화마다 다르지 않다 */
const SCOPE = "user";

export function createSetupCommands(
  run: Run,
  onInvalidated: (listener: () => void) => () => void,
  binaryReport: BinaryReportSource,
): SetupCommands {
  return {
    async load() {
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
      const binaries = binaryViewOf(await binaryReport());
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
