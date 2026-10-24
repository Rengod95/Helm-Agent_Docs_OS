import { CapabilityError } from "@xeon/contracts/capabilities";

/** 거부를 기다려 CapabilityError를 돌려준다. 거부하지 않거나 다른 값으로 거부하면 시험이 실패한다 */
export async function rejection(promise: Promise<unknown>): Promise<CapabilityError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof CapabilityError) return caught;
    throw caught;
  }
  throw new Error("expected the call to reject with a CapabilityError");
}

export function numbered(count: number, text = "line"): string {
  return Array.from({ length: count }, (_, index) => `${text} ${index + 1}`).join("\n");
}
