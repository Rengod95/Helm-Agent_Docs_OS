import { err, type Result } from "@fresnel/contracts";
import type { EvidenceRef, ImportedHookOrigin } from "@fresnel/contracts/extensions";
import type { Provenance } from "@fresnel/contracts/wire";
import type { PluginPortFailure } from "../../handlers/m5/plugins.ts";

// 공유 입구 `PluginDraftIntake`(migration.md §7.5 [제안], profile-project-loader.md §4.9). 폴더를 초안 스냅샷으로 만들고
// 같은 직렬 구간 안에서 검토 항목을 만든다(§4.9의 두 단계를 한 번에). 담당 AI 제출(`assistant`), 한 줄 지침(`user_instruction`),
// 마이그레이션(`migration`)이 이 입구를 좁은 얼굴로 부른다. 입구는 wire 메서드가 아니다.
// 직렬화는 검토 서비스가 맡는다(`PluginAdmission.admit`). 초안과 항목 사이에 원본 훑기가 끼어들면 같은 폴더의 `unknown` 항목이 생기므로 한 구간이어야 한다.

/** 입구로 들어오는 출처. 원본 훑기가 만드는 `project`, `unknown`, `bundled`는 여기로 오지 않는다 */
type IntakeProvenance = Extract<Provenance, "assistant" | "user_instruction" | "migration">;

/**
 * 준비 단계. 직렬 구간 안에서 초안을 만들기 전에 돈다(폴더를 쓰는 일이 여기 든다). 실패하면 초안도 항목도 만들지 않는다.
 * 준비가 쓴 폴더는 되돌리지 않는다. 초안 단계가 실패하면 그 폴더는 남는다
 */
export type IntakePrepare = () => Promise<Result<void, PluginPortFailure>>;

interface IntakeBase {
  /** 초안을 만들 폴더(플러그인 원본 폴더 또는 담당 AI가 만든 임시 폴더) */
  readonly dir: string;
  /** 승인할 때 기본 대상 프로필 */
  readonly originProfileId?: string | null | undefined;
  /** 목적 한 문장. 비어 있으면 승인할 수 없다(§4.7.6) */
  readonly purpose?: string | undefined;
  readonly prepare?: IntakePrepare | undefined;
}

/**
 * 입구 요청. `assistant`만 증거를 한 개 이상 요구한다(§4.7.1). 다른 출처는 증거 없이 제출할 수 있다.
 * `assistant`는 만든 대화가 있어야 하고, 한 줄 지침과 마이그레이션은 대화가 없다(`originThreadId: null`)
 */
export type IntakeRequest =
  | (IntakeBase & {
      readonly provenance: "assistant";
      readonly originThreadId: string;
      readonly evidence: readonly [EvidenceRef, ...EvidenceRef[]];
    })
  | (IntakeBase & {
      readonly provenance: "user_instruction" | "migration";
      readonly originThreadId: string | null;
      readonly evidence: readonly EvidenceRef[];
      /** 가져온 훅의 출처(가져오기 계획의 값). `migration` 제출만 싣는다. 검토 항목의 카드가 이 값을 훅 출처로 적는다 */
      readonly importedHookOrigin?: ImportedHookOrigin | undefined;
    });

/** 입구가 검토 서비스에 넘기는 한 번의 요청. 검토 서비스는 직렬 큐 안에서 준비, 초안, 항목 순으로 한다 */
export interface AdmitInput {
  readonly dir: string;
  readonly provenance: IntakeProvenance;
  readonly originThreadId: string | null;
  readonly originProfileId: string | null;
  readonly evidence: readonly EvidenceRef[];
  readonly purpose: string | undefined;
  readonly prepare: IntakePrepare | undefined;
  /** 가져온 훅의 출처. 출처가 `migration`일 때만 있다 */
  readonly importedHookOrigin: ImportedHookOrigin | undefined;
}

/** 입구의 결과. 초안 id와 항목 id다 */
export interface AdmitResult {
  readonly draftId: string;
  readonly itemId: string;
}

/** 직렬 구간에서 초안과 항목을 한 번에 만든다. 검토 서비스가 구현한다 */
export interface PluginAdmission {
  admit(input: AdmitInput): Promise<Result<AdmitResult, PluginPortFailure>>;
}

/** 공유 입구. 호출자는 출처에 맞는 얼굴로만 부른다 */
export interface PluginDraftIntake {
  submit(request: IntakeRequest): Promise<Result<AdmitResult, PluginPortFailure>>;
}

/** 입구를 만든다. 검토 서비스가 자기 직렬 큐를 `admission`으로 넘긴다 */
export function createPluginDraftIntake(admission: PluginAdmission): PluginDraftIntake {
  return {
    submit: async (request): Promise<Result<AdmitResult, PluginPortFailure>> => {
      // 타입이 먼저 거절하지만, 타입을 벗어난 호출자도 같은 값을 받도록 실행 때도 본다
      if (request.provenance === "assistant" && request.evidence.length === 0) {
        return err({
          kind: "draft_invalid",
          issues: [
            {
              code: "evidence_required",
              severity: "error",
              path: "/evidence",
              message: "an assistant submission needs at least one evidence reference",
            },
          ],
        });
      }
      return admission.admit({
        dir: request.dir,
        provenance: request.provenance,
        originThreadId: request.originThreadId,
        originProfileId: request.originProfileId ?? null,
        evidence: request.evidence,
        purpose: request.purpose,
        prepare: request.prepare,
        importedHookOrigin:
          request.provenance === "migration" ? request.importedHookOrigin : undefined,
      });
    },
  };
}
