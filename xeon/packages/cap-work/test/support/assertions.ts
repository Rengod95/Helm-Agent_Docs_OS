import { Bug } from "@xeon/contracts";
import { CapabilityError } from "@xeon/contracts/capabilities";

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
