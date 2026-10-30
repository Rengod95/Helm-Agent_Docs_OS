// 시험 도우미: 거부 코드 확인과 리뷰 보기에서 hunk 상태 목록 만들기.
import { Bug } from "@xeon/contracts";
import { CapabilityError, type ReviewView } from "@xeon/contracts/capabilities";

/** 거부를 기다려 CapabilityError를 돌려준다. 거부하지 않으면 시험이 실패한다 */
export async function rejection(promise: Promise<unknown>): Promise<CapabilityError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof CapabilityError) return caught;
    throw caught;
  }
  throw new Bug("expected the call to reject with a CapabilityError");
}

/** 거부 코드만 돌려준다 */
export async function codeOf(promise: Promise<unknown>): Promise<string> {
  return (await rejection(promise)).data.code;
}

/** 파일 순서대로 [hunkId, decision, applied] */
export function hunkStates(view: ReviewView): string[][] {
  return view.files.flatMap((file) =>
    file.hunks.map((hunk) => [hunk.hunkId, hunk.decision, hunk.applied]),
  );
}
