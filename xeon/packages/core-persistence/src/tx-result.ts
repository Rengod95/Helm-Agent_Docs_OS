import { Bug, err, ok, type Result } from "@xeon/contracts";
import type { SqlTx, StoreDb, StoreWriteError } from "@xeon/contracts/records";

/** 롤백용 표지. writeResult 밖으로 나가지 않는다(TY-11 허용 3, eng.transactions.design §4.2 끝) */
const ROLLBACK_MARKER = new Bug(
  "store.rollback_marker: internal marker, never escapes writeResult",
);

/**
 * 쓰기 트랜잭션. fn이 err를 돌려주면 롤백하고 그 오류를 돌려준다.
 * 저장소는 콜백이 던질 때만 롤백하므로(bun:sqlite 계약) 표지를 던지고 여기서 잡아 err로 바꾼다
 */
export function writeResult<T, E>(
  db: Pick<StoreDb, "write">,
  fn: (tx: SqlTx) => Result<T, E>,
): Result<T, E | StoreWriteError> {
  const failure: { error: E | undefined; set: boolean } = { error: undefined, set: false };
  let written: Result<T, StoreWriteError>;
  try {
    written = db.write((tx): T => {
      const outcome = fn(tx);
      if (outcome.ok) return outcome.value;
      failure.error = outcome.error;
      failure.set = true;
      throw ROLLBACK_MARKER;
    });
  } catch (caught) {
    if (caught === ROLLBACK_MARKER && failure.set && failure.error !== undefined) {
      return err(failure.error);
    }
    throw caught;
  }
  return written.ok ? ok(written.value) : written;
}
