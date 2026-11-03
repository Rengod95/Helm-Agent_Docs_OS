import { err, ok, type Result } from "@fresnel/contracts";
import type {
  HostErrorMappers,
  ProfileWriteFailure,
} from "../../src/handlers/m4/profile-test-run.ts";
import { threadLocked } from "../../src/handlers/owner.ts";
import { wireErrorOfStore } from "../../src/store-error.ts";

// 순서 덮어쓰기 시험의 설정 저장소 대역. 쓰기와 되돌리기를 기록하고, 저장한 값을 원천(`saved()`)이 다시 읽게 한다.
// 실패를 넣으면 쓰기가 그 실패를 돌려주고 아무것도 저장하지 않는다.

/** 기록한 설정 쓰기 한 번. 되돌리기(reset)는 value가 undefined다 */
interface SettingsCall {
  readonly op: "write" | "reset";
  readonly scope: string;
  readonly key: string;
  readonly value: unknown;
  readonly threadId: unknown;
}

export interface RecordingEnv {
  /** `createExtReadPort`의 `env`에 넘긴다 */
  readonly env: {
    readonly settings: {
      write(
        scope: string,
        key: string,
        value: unknown,
        threadId: unknown,
      ): Promise<Result<void, ProfileWriteFailure>>;
      reset(
        scope: string,
        key: string,
        threadId: unknown,
      ): Promise<Result<void, ProfileWriteFailure>>;
    };
    readonly errors: HostErrorMappers;
  };
  readonly calls: SettingsCall[];
  /** 저장된 설정 값(키 → 값). 훅 순서 원천이 이것을 `hookOrderOf`로 읽는다 */
  readonly values: Map<string, unknown>;
}

export function recordingEnv(
  options: { readonly failure?: ProfileWriteFailure } = {},
): RecordingEnv {
  const calls: SettingsCall[] = [];
  const values = new Map<string, unknown>();
  const outcome = (): Result<void, ProfileWriteFailure> =>
    options.failure === undefined ? ok(undefined) : err(options.failure);
  return {
    env: {
      settings: {
        write(scope, key, value, threadId) {
          calls.push({ op: "write", scope, key, value, threadId });
          const result = outcome();
          if (result.ok) values.set(key, value);
          return Promise.resolve(result);
        },
        reset(scope, key, threadId) {
          calls.push({ op: "reset", scope, key, value: undefined, threadId });
          const result = outcome();
          if (result.ok) values.delete(key);
          return Promise.resolve(result);
        },
      },
      errors: { ofStore: wireErrorOfStore, threadLocked: () => threadLocked(null) },
    },
    calls,
    values,
  };
}
