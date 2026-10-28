import type { RedactionHit } from "@xeon/contracts/capabilities";
import type { Redactor } from "@xeon/contracts/services";

// L0.secrets.spec §3.5.1 (M3-REQ-59). 이미 기록된 이벤트의 사후 가림. 표시, 내보내기, 모델 입력 단계가 읽는 시점에 Redactor를 적용한다.
// 저장된 원본 행은 바꾸지 않는다(maskDeep은 새 값을 돌려준다). 그래서 나중에 값을 등록한 비밀도 이전 기록의 표시와 내보내기에서 가려진다.
// 가림은 보조 수단이다(§3.5 한계). 값이 이미 모델이나 외부에 나갔다면 가려도 되돌릴 수 없어 키 회전 안내를 함께 돌려준다.

export type PostHocStage = "display" | "export" | "model-input";

/** 하위 층은 문장을 만들지 않는다. L4가 kind와 이름으로 안내문을 만든다 */
export interface RotateKeyAdvice {
  readonly kind: "rotate_key";
  /** 가려진 알려진 비밀 이름(중복 없음, 정렬) */
  readonly names: readonly string[];
  /** 이름 없이 패턴(접두, 키-값)으로 가려진 개수 */
  readonly patternHits: number;
}

export interface PostHocResult<T> {
  readonly stage: PostHocStage;
  readonly value: T;
  readonly hits: readonly RedactionHit[];
  /** 가려진 것이 있을 때만. 없으면 null */
  readonly advice: RotateKeyAdvice | null;
}

export interface PostHocRedaction {
  /** 값을 깊게 복사하며 문자열만 가린다. 입력은 바뀌지 않는다 */
  apply<T>(stage: PostHocStage, value: T): PostHocResult<T>;
}

const KNOWN_PREFIX = "known:";

function adviceFor(hits: readonly RedactionHit[]): RotateKeyAdvice | null {
  if (hits.length === 0) return null;
  const names = new Set<string>();
  let patternHits = 0;
  for (const hit of hits) {
    if (hit.kind.startsWith(KNOWN_PREFIX)) names.add(hit.kind.slice(KNOWN_PREFIX.length));
    else patternHits += hit.count;
  }
  return { kind: "rotate_key", names: [...names].toSorted(), patternHits };
}

export function createPostHocRedaction(redactor: Pick<Redactor, "maskDeep">): PostHocRedaction {
  return {
    apply(stage, value) {
      const masked = redactor.maskDeep(value);
      return { stage, value: masked.value, hits: masked.hits, advice: adviceFor(masked.hits) };
    },
  };
}
