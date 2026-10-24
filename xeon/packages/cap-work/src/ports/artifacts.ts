import type { Result } from "@xeon/contracts";
import type { ArtifactRef } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";

// L2.work.spec §4.2.4 2. 계획 본문을 산출물(kind plan)로 등록하는 선택 의존. `artifacts.registry`의 정의가 F에 들어오면
// (L2.artifacts M3) 어댑터가 이 모양으로 감싼다. 없으면 `artifact: null`로 제출한다.

export interface PlanArtifactInput {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly body: string;
  /** `plan:<planId>:<version>`. 같은 키의 재시도는 같은 결과를 낸다 */
  readonly requestId: string;
  readonly meta: { readonly planId: string; readonly planVersion: number };
}

export type ArtifactFailure = {
  readonly kind: "unavailable" | "rejected";
  readonly message: string;
};

export interface PlanArtifactsPort {
  /** 첫 판 */
  register(input: PlanArtifactInput): Promise<Result<ArtifactRef, ArtifactFailure>>;
  /** 같은 계획의 다음 판: 같은 산출물의 버전을 늘린다 */
  update(
    input: PlanArtifactInput & { readonly artifactId: string },
  ): Promise<Result<ArtifactRef, ArtifactFailure>>;
}
