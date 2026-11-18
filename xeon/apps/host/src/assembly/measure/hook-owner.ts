import type { RegistrationInfo } from "@fresnel/ext-host";
import type { HookOwnerOf } from "./turn-rows.ts";

// 훅 행의 `plugin`과 `versionId`를 정하는 조회(정본 `docs/xeon/review/m5/turn-record-metrics.md` §3.2 `HookRun`).
// 처리기 기록의 `registrationId`는 등록 범위 id다. 등록을 찾으면 확장 이름이 `plugin`, 그 확장의 로더 검토본 해시가 `versionId`다.
// 코어 단위도 등록이라 이름은 단위 이름이고, 해시가 없어 `versionId`는 null이다. 등록을 찾지 못하는 id(외부 훅 단위 `hook:<id>`)는 undefined다.
// 해시는 행을 쓰는 순간(단계 끝)의 로더 값이다. 판이 바뀌는 시점은 경계이고 단계 끝이 그 앞에 온다(§4.10 규칙 63 [가정]).

export function hookOwnerLookup(input: {
  readonly registrations: () => readonly RegistrationInfo[];
  readonly contentHashOf: (name: string) => string | undefined;
}): HookOwnerOf {
  return (registrationId) => {
    const scope = input.registrations().find((info) => info.id === registrationId);
    if (scope === undefined) return undefined;
    return { plugin: scope.extension, versionId: input.contentHashOf(scope.extension) ?? null };
  };
}
