import { assertNever, type Result } from "@fresnel/contracts";
import {
  wireError,
  type ForeignFormatNotice,
  type MigrationApplyResult,
  type MigrationChangedParams,
  type MigrationChoices,
  type MigrationDetectResult,
  type MigrationProgressParams,
  type MigrationProposalResult,
  type MigrationReportGetResult,
  type MigrationScanResult,
  type MigrationScanRoot,
  type WireError,
  type WireHandlers,
} from "@fresnel/contracts/wire";
import { wireErrorOfProfile, type ProfilePortFailure } from "../m4/profile-test-run.ts";
import { wireErrorOfPluginFailure, type PluginPortFailure } from "./plugins.ts";

// 가져오기 wire(migration.md §7.7 [제안]). `migration.detect`, `scan`, `proposal`, `apply`, `report.get`, `dismiss`다.
// 처리기는 서비스(`assembly/plugins/migration.ts`)가 돌려준 값을 그대로 옮기고 실패만 wire 오류로 바꾼다.
// 알림 `migration.changed`와 `migration.progress`는 `onChanged`, `onProgress`를 연결 허브가 듣고 보낸다.

/** 서비스가 내는 실패. 예상 가능한 것만 둔다(TY-11). 판별자는 `kind`다 */
export type MigrationFailure =
  /** 훑을 폴더가 없거나 절대 경로가 아니다(`migration.rootInvalid`) */
  | { readonly kind: "root_invalid" }
  /** 항목 상한을 넘었다. 일부만 훑은 결과는 내지 않는다(`migration.scanLimit`) */
  | { readonly kind: "scan_limit" }
  /** 질문이 닫히지 않았다(`migration.questionsOpen`, `details.id`는 제안 id) */
  | { readonly kind: "questions_open"; readonly proposalId: string }
  /** 같은 이름의 플러그인 폴더나 프로필이 이미 있다(`migration.nameConflict`, `details.name`) */
  | { readonly kind: "name_conflict"; readonly name: string }
  /** 그 id의 훑기, 제안, 보고서가 없다(`migration.notFound`, `details.id`) */
  | { readonly kind: "not_found"; readonly id: string }
  /** `createProfiles`에 제안되지 않은 이름이 들었다(`jsonrpc.invalidParams`) */
  | { readonly kind: "profile_not_proposed"; readonly name: string }
  /** 상태 파일이나 원본 폴더를 읽고 쓰지 못했다(`store.io`). `code`는 시스템 오류 코드다 */
  | { readonly kind: "store"; readonly code: string }
  /** 제출 포트(플러그인 폴더와 검토함)의 실패. 같은 이름 충돌은 서비스가 `name_conflict`로 바꾼다 */
  | { readonly kind: "plugin"; readonly failure: PluginPortFailure }
  /** 프로필 저장소의 실패 */
  | { readonly kind: "profile"; readonly failure: ProfilePortFailure };

/** 처리기가 쓰는 가져오기 서비스 포트. 메서드 하나가 wire 메서드 하나다(알림 구독 둘 포함) */
export interface MigrationPort {
  detect(workspace: string): Promise<Result<MigrationDetectResult, MigrationFailure>>;
  /**
   * `trust.get`의 `foreignFormats`. 표지가 없거나 읽지 못하면 `undefined`다(신뢰 판정을 막지 않는다).
   * 프로젝트 루트는 신뢰 읽기가 준 정규 경로다
   */
  foreignFormatsOf(projectRoot: string): Promise<ForeignFormatNotice | undefined>;
  scan(roots: readonly MigrationScanRoot[]): Promise<Result<MigrationScanResult, MigrationFailure>>;
  proposal(
    scanId: string,
    choices: MigrationChoices | undefined,
  ): Promise<Result<MigrationProposalResult, MigrationFailure>>;
  apply(
    proposalId: string,
    choices: MigrationChoices,
    createProfiles: readonly string[],
  ): Promise<Result<MigrationApplyResult, MigrationFailure>>;
  reportGet(reportId: string): Promise<Result<MigrationReportGetResult, MigrationFailure>>;
  dismiss(root: string, marker: string): Promise<Result<void, MigrationFailure>>;
  /** 가져오기 상태가 바뀌었다(훑기, 제안, 적용, 숨김). 연결 허브가 `migration.changed`로 보낸다 */
  onChanged(listener: (change: MigrationChangedParams) => void): () => void;
  /** 훑기가 진행됐다. 연결 허브가 `migration.progress`로 보낸다 */
  onProgress(listener: (progress: MigrationProgressParams) => void): () => void;
}

export type MigrationMethods =
  | "migration.detect"
  | "migration.scan"
  | "migration.proposal"
  | "migration.apply"
  | "migration.report.get"
  | "migration.dismiss";

/** 가져오기 실패를 wire 오류로 옮긴다. 오류 이름과 번호는 `errors.ts`의 3670~3675를 쓴다 */
function wireErrorOfMigration(failure: MigrationFailure): WireError {
  switch (failure.kind) {
    case "root_invalid":
      return wireError("migration.rootInvalid");
    case "scan_limit":
      return wireError("migration.scanLimit");
    case "questions_open":
      return wireError("migration.questionsOpen", { details: { id: failure.proposalId } });
    case "name_conflict":
      return wireError("migration.nameConflict", { details: { name: failure.name } });
    case "not_found":
      return wireError("migration.notFound", { details: { id: failure.id } });
    case "profile_not_proposed":
      return wireError("jsonrpc.invalidParams", {
        details: {
          issues: [
            {
              path: "createProfiles",
              message: "a profile name must be one of the profileProposals of the proposal",
            },
          ],
        },
      });
    case "store":
      return wireError("store.io", {
        message: "migration: a file could not be read or written",
        details: { code: failure.code.slice(0, 64) },
      });
    case "plugin":
      return wireErrorOfPluginFailure(failure.failure);
    case "profile":
      return wireErrorOfProfile(failure.failure);
    default:
      return assertNever(failure, "MigrationFailure");
  }
}

async function unwrap<T>(call: Promise<Result<T, MigrationFailure>>): Promise<T> {
  const result = await call;
  if (!result.ok) throw wireErrorOfMigration(result.error);
  return result.value;
}

/** 가져오기 처리기. 메서드 하나가 포트 메서드 하나다 */
export function createMigrationHandlers(port: MigrationPort): Pick<WireHandlers, MigrationMethods> {
  return {
    "migration.detect": (params) => unwrap(port.detect(params.workspace)),
    "migration.scan": (params) => unwrap(port.scan(params.roots)),
    "migration.proposal": (params) => unwrap(port.proposal(params.scanId, params.choices)),
    "migration.apply": (params) =>
      unwrap(port.apply(params.proposalId, params.choices, params.createProfiles ?? [])),
    "migration.report.get": (params) => unwrap(port.reportGet(params.reportId)),
    "migration.dismiss": async (params) => {
      const result = await port.dismiss(params.root, params.marker);
      if (!result.ok) throw wireErrorOfMigration(result.error);
      return {};
    },
  };
}
