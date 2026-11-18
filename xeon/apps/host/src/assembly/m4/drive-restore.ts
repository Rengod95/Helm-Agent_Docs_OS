// 재시작 뒤 Drive 덧씌우기 되살리기의 후보 고르기(M5c §4.3.5). 입출력이 없는 값 계산이다. 검토본 확인과 얹기는 `ports.ts`와
// `plugin-set.ts`가 한다.

/** 열린 임대 가운데 판 식별자를 가진 것. `lease.acquired`의 `scopeId`와 `contentHash`다 */
export interface OpenLeaseRef {
  readonly scopeId: string;
  readonly contentHash: string | null;
}

/** 되살릴 후보 하나: 플러그인 이름과 그 임대가 쓴 판 식별자 */
export interface RestorableLease {
  readonly plugin: string;
  readonly contentHash: string;
}

/**
 * 열린 임대에서 되살릴 후보를 고른다. 판 식별자가 없는 임대(옛 기록, 내장 단위)는 빼고, scope의 플러그인 이름을 모르면 뺀다.
 * 같은 플러그인이 서로 다른 판의 임대를 둘 가지면 어느 판으로 되살릴지 정할 수 없으므로 둘 다 뺀다. 같은 판이면 한 번만 준다.
 * 프로필 밖인지는 얹는 쪽이 본다(프로필에 든 이름은 얹지 않는다)
 */
export function restorableLeasesOf(
  leases: readonly OpenLeaseRef[],
  pluginOf: (scopeId: string) => string | undefined,
): readonly RestorableLease[] {
  const hashes = new Map<string, Set<string>>();
  for (const lease of leases) {
    const plugin = pluginOf(lease.scopeId);
    if (plugin === undefined || lease.contentHash === null) continue;
    const seen = hashes.get(plugin) ?? new Set<string>();
    seen.add(lease.contentHash);
    hashes.set(plugin, seen);
  }
  return [...hashes].flatMap(([plugin, seen]) => {
    const [only, ...rest] = seen;
    return only === undefined || rest.length > 0 ? [] : [{ plugin, contentHash: only }];
  });
}
