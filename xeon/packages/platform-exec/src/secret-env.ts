import { err, ok, type Result } from "@xeon/contracts";
import { parseSecretRef } from "@xeon/contracts/capabilities";
import {
  ExecutionError,
  type SecretEnvRequest,
  type SecretLease,
  type SecretService,
} from "@xeon/contracts/services";
import { isValidEnvName } from "./env-builder.ts";

// L0.exec.spec §3.6. 에이전트 env 모드(M1)의 비밀 주입 지점. 값은 이 파일의 지역 변수와 spawn 인자에만 있다.

/** secrets 서비스 중 exec가 쓰는 메서드. platform-secrets를 import하지 않고 F 인터페이스로만 받는다(DR-02) */
export type SecretEnvSource = Pick<SecretService, "withEnv">;

/** 빌려 온 비밀 값. 폐기하면 lease를 닫는다 */
export interface SecretEnvLeases {
  /** env 이름 → 값. 호출이 끝나면 버린다 */
  readonly values: Readonly<Record<string, string>>;
  /** 얻은 lease를 모두 폐기한다. 두 번 불러도 된다 */
  dispose(): void;
}

export interface AcquireSecretEnvInput {
  readonly request: SecretEnvRequest;
  /** 실행할 명령. target(argv0, commandLine)을 채우는 데 쓴다 */
  readonly command: string | readonly string[];
  readonly secrets: SecretEnvSource | undefined;
  readonly signal: AbortSignal | undefined;
}

/** 명령에서 secrets가 정책(명령 패턴)을 판정할 target을 만든다 */
export function commandTarget(command: string | readonly string[]): {
  readonly kind: "command";
  readonly argv0: string;
  readonly commandLine: string;
} {
  if (typeof command === "string") {
    const trimmed = command.trim();
    return { kind: "command", argv0: trimmed.split(/\s+/)[0] ?? "", commandLine: trimmed };
  }
  return { kind: "command", argv0: command[0] ?? "", commandLine: command.join(" ") };
}

function fail(code: "secret_unavailable" | "aborted" | "env_denied", message: string) {
  return err(new ExecutionError(code, message));
}

/**
 * `secretEnv.refs`의 각 항목에 env 모드 lease를 연다. 하나라도 실패하면 이미 얻은 lease를 모두 폐기하고
 * `secret_unavailable`을 돌려준다. 오류 메시지에는 참조 이름(`secret://…`)만 넣는다.
 */
export async function acquireSecretEnv(
  input: AcquireSecretEnvInput,
): Promise<Result<SecretEnvLeases, ExecutionError>> {
  const entries = Object.entries(input.request.refs);
  const leases: SecretLease[] = [];
  const values: Record<string, string> = {};
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const name of Object.keys(values)) delete values[name];
    for (const lease of leases.splice(0)) lease.dispose();
  };

  if (entries.length === 0) return ok({ values, dispose });

  for (const [name] of entries) {
    if (!isValidEnvName(name)) {
      return fail("env_denied", `Invalid environment variable name for secretEnv: ${name}`);
    }
  }
  const secrets = input.secrets;
  if (secrets === undefined) {
    return fail(
      "secret_unavailable",
      `Secrets service is not available for: ${entries.map(([, ref]) => ref).join(", ")}`,
    );
  }

  const ctx = { ...input.request.ctx, target: commandTarget(input.command) };
  // 앞 lease가 열린 뒤에 다음 lease를 연다. 하나가 실패하면 이미 연 것을 모두 폐기해야 하므로 순서대로 한다.
  const leaseFrom = async (index: number): Promise<ExecutionError | undefined> => {
    const entry = entries[index];
    if (entry === undefined) return undefined;
    const [name, ref] = entry;
    if (input.signal?.aborted === true) return new ExecutionError("aborted", "aborted");
    const parsed = parseSecretRef(ref);
    if (!parsed.ok)
      return new ExecutionError("secret_unavailable", `Invalid secret reference: ${ref}`);
    const leased = await secrets.withEnv(parsed.value.handle, ctx);
    if (!leased.ok) {
      return new ExecutionError(
        "secret_unavailable",
        `Secret is unavailable: ${ref} (${leased.error.kind})`,
      );
    }
    leases.push(leased.value);
    const value = await leased.value.use((view) => view.text());
    if (!value.ok) {
      return new ExecutionError(
        "secret_unavailable",
        `Secret is unavailable: ${ref} (${value.error.kind})`,
      );
    }
    values[name] = value.value;
    return leaseFrom(index + 1);
  };
  const failure = await leaseFrom(0);
  if (failure !== undefined) {
    dispose();
    return err(failure);
  }
  if (input.signal?.aborted === true) {
    dispose();
    return fail("aborted", "aborted");
  }
  return ok({ values, dispose });
}
