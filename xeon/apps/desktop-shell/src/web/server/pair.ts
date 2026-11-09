// `POST /pair` 본문 검사(spec §8.3 2). 키는 정확히 셋(`code`, `deviceName`, `kind`)이고 다른 키는 거절한다.
// 기기 이름의 실제 규칙(공백만, 64글자, 제어 문자)은 `AuthPort.redeemPairingCode`가 본다. 여기서는 모양과 크기만 본다.
import { err, ok, parseJson, type Result } from "@fresnel/contracts";
import type { DeviceKind } from "../auth/devices.ts";
import { isRecord, ownField } from "../../main/lib/narrow.ts";

const FIELDS: ReadonlySet<string> = new Set(["code", "deviceName", "kind"]);
/** 코드 글자 수의 상한. 정규형은 10자이고 공백과 하이픈을 허용하므로 넉넉히 둔다 */
const MAX_CODE_LENGTH = 64;
/** 기기 이름 입력의 상한(글자 수). 실제 한도(64)는 `cleanDeviceName`이 본다 */
const MAX_NAME_INPUT_LENGTH = 256;

export interface PairRequest {
  readonly code: string;
  readonly deviceName: string;
  readonly kind: DeviceKind;
}

export type PairBodyError = { readonly kind: "invalid_body" };

function invalidBody(): Result<never, PairBodyError> {
  return err({ kind: "invalid_body" });
}

export function parsePairRequest(text: string): Result<PairRequest, PairBodyError> {
  const json = parseJson(text);
  if (!json.ok) return invalidBody();
  const body = json.value;
  if (!isRecord(body)) return invalidBody();
  if (Object.keys(body).some((key) => !FIELDS.has(key))) return invalidBody();
  const code = ownField(body, "code");
  const deviceName = ownField(body, "deviceName");
  const kind = ownField(body, "kind");
  if (typeof code !== "string" || code.length === 0 || code.length > MAX_CODE_LENGTH) {
    return invalidBody();
  }
  if (typeof deviceName !== "string" || deviceName.length > MAX_NAME_INPUT_LENGTH) {
    return invalidBody();
  }
  if (kind !== "web" && kind !== "desktop") return invalidBody();
  return ok({ code, deviceName, kind });
}
