import type { SecretProviderId } from "@xeon/contracts/capabilities";
import type { SecretDiagnostics } from "@xeon/contracts/services";

// L0.secrets.spec §4.8, plan SC-16. 안내문은 값을 싣지 않는다. 마스킹은 단정하지 않고 "보조 수단"이라고 쓴다.

/** 첫 줄은 개발 환경 레시피, 둘째 줄은 공개 배포 사용자용 명령(spec §4.8 (a)) */
const REGISTER_HINTS: readonly string[] = ["just secret-add <키> [env]", "xeon secret add <name>"];

const FILE_FALLBACK_NOTICE =
  "키가 디스크 파일에 있다. 같은 사용자 권한의 프로그램은 읽을 수 있다. 마스킹은 보조 수단이다.";
const CONFIRM_FALLBACK_HINT =
  "OS 키 저장소를 쓸 수 없어 파일 폴백이 필요하다. 확인했으면 l0.secrets.ageKey.source를 file로 저장한다.";
const SOPS_INSTALL_HINT = "sops 3.10.0 이상(권장 3.12.0 이상)을 설치한다.";

export interface DiagnoseInput {
  readonly sops: SecretDiagnostics["sops"];
  readonly key: SecretDiagnostics["key"];
  readonly fileFallbackNotice: boolean;
  readonly unconfirmedFallback: boolean;
  readonly providers: SecretDiagnostics["providers"];
  readonly missing: number;
  readonly orphaned: number;
}

export function assembleDiagnostics(input: DiagnoseInput): SecretDiagnostics {
  const hints = [...REGISTER_HINTS];
  if (!input.sops.available) hints.push(SOPS_INSTALL_HINT);
  if (input.fileFallbackNotice) hints.push(FILE_FALLBACK_NOTICE);
  if (input.unconfirmedFallback) hints.push(CONFIRM_FALLBACK_HINT);
  return {
    hints,
    sops: input.sops,
    key: input.key,
    fileFallbackNotice: input.fileFallbackNotice,
    providers: input.providers,
    missing: input.missing,
    orphaned: input.orphaned,
  };
}

export function providerRow(
  id: SecretProviderId,
  registered: boolean,
  entries: number | null,
): SecretDiagnostics["providers"][number] {
  return { id, registered, entries };
}
