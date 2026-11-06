import { parse } from "@fresnel/contracts";
import { WIRE_ERRORS, WireError } from "@fresnel/contracts/wire";
import { Type } from "typebox";
import type { LockedOption } from "../state/ui/index.ts";
import type { CommandError } from "../views/commands.ts";

// wire 오류를 화면이 구분하는 오류로 바꾼다. 구분하는 것은 셋이다:
// - -32601: host에 그 메서드가 없다(unsupported). 오래된 엔진이거나 아직 구현하지 않은 메서드다.
// - 3002 thread.locked: 다른 프로세스가 쓰기 소유를 쥐었다. 대안 목록은 host가 준 details에서 읽는다.
// - 3102 settings.invalidValue: 저장하려던 값이 틀렸다(예: 모르는 모델 id). host가 쓴 첫 문제의 문장을 남긴다.
// - 그 밖: 코드만 남긴다.

const METHOD_NOT_FOUND = WIRE_ERRORS["jsonrpc.methodNotFound"].code;
const LOCKED_CODE = WIRE_ERRORS["thread.locked"].code;
const INVALID_VALUE_CODE = WIRE_ERRORS["settings.invalidValue"].code;
/** 제작 wire(`ext.*`)가 입력 문제를 알리는 `<DevkitError 종류>: ` 머리(`ext.versions`의 `history_unavailable`·`unknown_extension`: 번들·프로젝트·기본 내장 확장은 설치 기록이 없다). 다른 메서드의 입력 거절 문장은 건드리지 않는다 */
const DEVKIT_ISSUE =
  /^(invalid_input|not_found|exists|blocked_kind|denied|dev_mode_required|source_changed|managed_locked|not_absolute|no_manifest|attachment_too_large|attachment_type_unsupported|history_unavailable|unknown_extension): /;
const INVALID_PARAMS_CODE = WIRE_ERRORS["jsonrpc.invalidParams"].code;
/** 값 검사 실패의 details(wire/errors.ts `settings.invalidValue`). 첫 문제의 문장만 쓴다 */
const InvalidValueDetailsSchema = Type.Object({
  issues: Type.Array(Type.Object({ message: Type.String({ maxLength: 512 }) }), { minItems: 1 }),
});
/** 입력 거절의 details. 첫 문제의 문장과 그 입력 이름(`path`, 예: `planId`)을 읽는다 */
const InvalidParamsDetailsSchema = Type.Object({
  issues: Type.Array(
    Type.Object({
      path: Type.Optional(Type.String({ maxLength: 128 })),
      message: Type.String({ maxLength: 512 }),
    }),
  ),
});
/** 계약의 details 스키마(wire/errors.ts)와 같은 모양. 대안 이름은 모르는 값을 버리려고 문자열로 읽는다 */
const LockedDetailsSchema = Type.Object({
  ownerKind: Type.String({ maxLength: 32 }),
  options: Type.Array(Type.String({ maxLength: 16 }), { maxItems: 8 }),
});

/** 화면이 그릴 수 있는 대안만 남긴다. `delegate`는 서비스 공급원에서만 있어 데스크톱 사이드카에는 보이지 않는다 */
function visibleOptions(options: readonly string[]): readonly LockedOption[] {
  const out: LockedOption[] = [];
  for (const option of options) {
    if (option === "observe" || option === "fork") out.push(option);
  }
  return out;
}

export function errorOf(cause: unknown): CommandError {
  if (!(cause instanceof WireError)) return { kind: "failed" };
  if (cause.code === METHOD_NOT_FOUND) return { kind: "unsupported" };
  if (cause.code === LOCKED_CODE) {
    // details는 프로세스 밖의 값이다(TY-10). 모양이 맞지 않으면 대안 없이 잠김만 알린다
    const details = parse(LockedDetailsSchema, cause.data.details);
    return details.ok
      ? {
          kind: "locked",
          ownerKind: details.value.ownerKind,
          options: visibleOptions(details.value.options),
        }
      : { kind: "locked", ownerKind: "unknown", options: [] };
  }
  if (cause.code === INVALID_VALUE_CODE) {
    const details = parse(InvalidValueDetailsSchema, cause.data.details);
    const detail = details.ok ? details.value.issues[0]?.message : undefined;
    if (detail !== undefined) return { kind: "rejected", code: cause.code, detail };
  }
  if (cause.code === INVALID_PARAMS_CODE) {
    // 설치처럼 입력 문제를 `<종류>: <내용>` 문장으로 알리는 메서드가 있다. 첫 문장을 `issue`에 남긴다(화면이 종류를 가른다).
    // 입력 이름은 `path`에 남긴다(예: 모르는 계획 id는 `planId`다)
    const details = parse(InvalidParamsDetailsSchema, cause.data.details);
    const first = details.ok ? details.value.issues[0] : undefined;
    if (first !== undefined) {
      return {
        kind: "rejected",
        code: cause.code,
        ...(DEVKIT_ISSUE.test(first.message) ? { issue: first.message } : {}),
        ...(first.path === undefined ? {} : { path: first.path }),
      };
    }
  }
  return { kind: "rejected", code: cause.code };
}
