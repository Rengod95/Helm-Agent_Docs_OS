import { PrimitiveError } from "@xeon/ext-host";
import { INITIAL_HELM_STATE, type HelmState } from "../../src/state.ts";

export interface FakeStateApi {
  state(): Readonly<HelmState>;
  commit(next: HelmState): Promise<Readonly<HelmState>>;
  readonly commits: HelmState[];
}

/** 커밋마다 지연을 두는 가짜 상태 문서. `conflicts`번 state_conflict를 낸다 */
export function fakeStateApi(
  initial: HelmState = INITIAL_HELM_STATE,
  options: { readonly conflicts?: number; readonly delay?: boolean } = {},
): FakeStateApi {
  let current = initial;
  let conflicts = options.conflicts ?? 0;
  const commits: HelmState[] = [];
  return {
    commits,
    state: () => current,
    async commit(next) {
      if (options.delay === true) await Promise.resolve();
      if (conflicts > 0) {
        conflicts -= 1;
        throw new PrimitiveError("state_conflict", "state revision moved");
      }
      current = next;
      commits.push(next);
      return next;
    },
  };
}
