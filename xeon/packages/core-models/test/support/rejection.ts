/** reject된 값을 돌려준다. 이행되면 undefined. await-thenable 규칙을 피하려고 rejects 매처 대신 쓴다 */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}
