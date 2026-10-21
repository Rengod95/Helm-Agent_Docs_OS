/** 약속이 거부된 값을 돌려준다. 거부되지 않으면 Error를 던진다 */
export async function rejectionOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (caught) {
    return caught;
  }
  throw new Error("expected the promise to reject");
}
