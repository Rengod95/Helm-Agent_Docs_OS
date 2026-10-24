import { attemptAsync } from "@xeon/contracts";

/** 약속이 거부한 이유를 돌려준다. 이행되면 undefined */
export async function rejection(work: Promise<unknown>): Promise<unknown> {
  const outcome = await attemptAsync(() => work);
  return outcome.ok ? undefined : outcome.error.cause;
}
