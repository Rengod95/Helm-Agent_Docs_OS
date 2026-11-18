import type { Result } from "@fresnel/contracts";
import type { KnowledgeActor } from "@fresnel/contracts/capabilities";
import type { KnowledgeFailure } from "../errors.ts";

// 사용자 범위 스킬 만들기의 싱크 포트(L2.knowledge §7.5 [제안]). cap-knowledge는 플러그인 검토를 모른다. 조립 루트가 검토 입구로
// 구현해 `KnowledgePluginOptions.userSkillSink`로 넘긴다. 싱크가 없으면 사용자 범위 만들기는 `unavailable`이다.

/** 싱크가 받는 한 번의 만들기. 파일 경로는 스킬 폴더 기준 상대 경로다 */
export interface UserSkillSubmission {
  readonly name: string;
  readonly description: string;
  readonly files: readonly { readonly path: string; readonly bytes: Uint8Array }[];
  readonly actor: KnowledgeActor;
  /** 만든 대화. 호출 문맥에 없으면 undefined */
  readonly threadId: string | undefined;
  /** 만든 turn. 출처 증거를 만들 때 쓴다. 없으면 undefined */
  readonly turnId: string | undefined;
  /**
   * 사람이 이미 승인한 만들기인가: 제안 재실행, 사용자 행위자, 신뢰된 승인 증거(학습 대기열). 참이면 검토 항목을 곧바로 승인한다.
   * 거짓이면 검토 항목을 대기 상태로 남긴다
   */
  readonly approvedByUser: boolean;
  /** 호출자가 준 사유(`note` 또는 `reason`) */
  readonly reason: string | undefined;
}

/** 싱크의 결과. `approved`는 검토 항목이 승인되어 승인본이 되었는가다 */
export interface UserSkillSubmitted {
  readonly itemId: string;
  readonly approved: boolean;
}

export interface UserSkillSink {
  submit(input: UserSkillSubmission): Promise<Result<UserSkillSubmitted, KnowledgeFailure>>;
}
