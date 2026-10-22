import {
  Bug,
  err,
  ok,
  type Clock,
  type Result,
  type Scheduler,
  type TimerHandle,
} from "@xeon/contracts";
import { LEASE_RESOURCE_PATTERN } from "@xeon/contracts/records";
import type {
  LeaseError,
  LeaseHolder,
  LeaseKind,
  LeaseOwnerInfo,
  LeaseResource,
  LeaseRowInvalid,
  LeaseService,
  LeaseToken,
  SqlRow,
  SqlTx,
  StoreWriteError,
} from "@xeon/contracts/records";
import { assertNotInWrite, createStoreDb, type StoreConnections } from "./db.ts";
import type { StoreFaultInjector } from "./fault-points.ts";
import type { LockHandle, LockProvider } from "./lock/provider.ts";
import { leaseColumns } from "./rows.ts";

interface LeaseSettings {
  readonly heartbeatMs: number;
  readonly leaseTtlMs: number;
}

export interface LeaseDeps {
  readonly conn: StoreConnections;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly locks: LockProvider;
  readonly settings: LeaseSettings;
  /** OsService.processStartFingerprint(동기). 프로세스가 없으면 null. OS 잠금이 없을 때의 생존 판정 */
  readonly processStartedAt: (pid: number) => number | null;
  readonly faults: StoreFaultInjector;
}

/** close()가 쓰는 확장 인터페이스 */
export interface LeaseController extends LeaseService {
  /** 이 프로세스가 쥔 임대를 모두 반납하고 keepAlive를 멈춘다. 반납 실패는 만료에 맡긴다 */
  releaseAll(): void;
}

const LEASE_RESOURCE = new RegExp(LEASE_RESOURCE_PATTERN);

interface Owned {
  readonly holderId: string;
  readonly epoch: number;
  readonly handle: LockHandle;
}

type Decision =
  | { readonly kind: "granted"; readonly epoch: number }
  | { readonly kind: "active"; readonly owner: LeaseOwnerInfo }
  | { readonly kind: "row_invalid"; readonly fault: LeaseRowInvalid };

function leaseKindOf(raw: string): Result<LeaseKind, LeaseRowInvalid> {
  if (raw === "cli" || raw === "app" || raw === "service") return ok(raw);
  return err({ kind: "row_invalid", where: "sys_leases.kind" });
}

function ownerInfoOf(row: SqlRow): Result<LeaseOwnerInfo, LeaseRowInvalid> {
  const c = leaseColumns(row);
  const holderId = c.string("holder_id");
  if (!holderId.ok) return holderId;
  const rawKind = c.string("kind");
  if (!rawKind.ok) return rawKind;
  const kind = leaseKindOf(rawKind.value);
  if (!kind.ok) return kind;
  const pid = c.int("pid");
  if (!pid.ok) return pid;
  const startedAt = c.int("started_at");
  if (!startedAt.ok) return startedAt;
  const host = c.string("host");
  if (!host.ok) return host;
  const epoch = c.int("epoch");
  if (!epoch.ok) return epoch;
  const heartbeatAt = c.int("heartbeat_at");
  if (!heartbeatAt.ok) return heartbeatAt;
  const expiresAt = c.int("expires_at");
  if (!expiresAt.ok) return expiresAt;
  return ok({
    holderId: holderId.value,
    kind: kind.value,
    pid: pid.value,
    startedAt: startedAt.value,
    host: host.value,
    epoch: epoch.value,
    heartbeatAt: heartbeatAt.value,
    expiresAt: expiresAt.value,
  });
}

/** 반납되지 않은 행의 소유 정보. 반납된 행은 null이다 */
function liveOwnerOf(row: SqlRow): Result<LeaseOwnerInfo | null, LeaseRowInvalid> {
  const released = leaseColumns(row).nullableInt("released_at");
  if (!released.ok) return released;
  return released.value === null ? ownerInfoOf(row) : ok(null);
}

function mapWriteError(error: StoreWriteError): LeaseError {
  switch (error.kind) {
    case "busy":
      return { kind: "busy" };
    case "disk_full":
      return { kind: "disk_full" };
    case "io":
      return { kind: "lock_io", code: error.code };
    default:
      throw new Bug("store.write_error_invalid");
  }
}

const SELECT_LEASE = `SELECT holder_id, epoch, kind, pid, started_at, host, heartbeat_at, expires_at, released_at
  FROM sys_leases WHERE resource = ?`;

export function createLeaseService(deps: LeaseDeps): LeaseController {
  const { conn, clock, scheduler, locks, settings, faults } = deps;
  const db = createStoreDb(conn, { internal: true });
  const owned = new Map<LeaseResource, Owned>();
  const alarms = new Set<Disposable>();

  const assertOpen = (): void => {
    if (conn.state.phase !== "open") throw new Bug("store.closed: the store is closed");
  };

  const dropOwned = (token: LeaseToken): void => {
    const entry = owned.get(token.resource);
    if (entry === undefined || entry.holderId !== token.holderId || entry.epoch !== token.epoch) {
      return;
    }
    owned.delete(token.resource);
    entry.handle.release();
  };

  /** 표시용 소유 정보. 읽지 못하거나 행을 해석하지 못하면 null이다(판정에 쓰지 않는다) */
  const readOwner = (resource: LeaseResource): LeaseOwnerInfo | null => {
    const read = db.read((tx) => tx.get(SELECT_LEASE, [resource]));
    if (!read.ok || read.value === undefined) return null;
    const owner = liveOwnerOf(read.value);
    return owner.ok ? owner.value : null;
  };

  const decide = (
    tx: SqlTx,
    resource: LeaseResource,
    holder: LeaseHolder,
    now: number,
  ): Decision => {
    const row = tx.get(SELECT_LEASE, [resource]);
    const expiresAt = now + settings.leaseTtlMs;
    const write = (epoch: number, exists: boolean): void => {
      const params = [
        holder.holderId,
        epoch,
        holder.kind,
        holder.pid,
        holder.startedAt,
        holder.host,
        now,
        expiresAt,
      ] as const;
      if (exists) {
        tx.run(
          `UPDATE sys_leases SET holder_id = ?, epoch = ?, kind = ?, pid = ?, started_at = ?, host = ?,
             heartbeat_at = ?, expires_at = ?, released_at = NULL WHERE resource = ?`,
          [...params, resource],
        );
      } else {
        tx.run(
          `INSERT INTO sys_leases (resource, holder_id, epoch, kind, pid, started_at, host, heartbeat_at, expires_at, released_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [resource, ...params],
        );
      }
    };
    if (row === undefined) {
      write(1, false);
      return { kind: "granted", epoch: 1 };
    }
    const parsedInfo = ownerInfoOf(row);
    if (!parsedInfo.ok) return { kind: "row_invalid", fault: parsedInfo.error };
    const info = parsedInfo.value;
    const releasedAt = leaseColumns(row).nullableInt("released_at");
    if (!releasedAt.ok) return { kind: "row_invalid", fault: releasedAt.error };
    const released = releasedAt.value !== null;
    // 같은 holder의 보유 중 행: epoch를 유지하고 만료만 늘린다
    if (!released && info.holderId === holder.holderId) {
      write(info.epoch, true);
      return { kind: "granted", epoch: info.epoch };
    }
    if (released || info.expiresAt < now) {
      write(info.epoch + 1, true);
      return { kind: "granted", epoch: info.epoch + 1 };
    }
    if (info.host === holder.host) {
      // OS 잠금을 얻었으면 이전 소유자는 살아 있지 않다. OS 잠금이 없으면 프로세스 지문으로 생존을 본다
      const ownerGone =
        locks.kind !== "none" ||
        (() => {
          const started = deps.processStartedAt(info.pid);
          return started === null || started !== info.startedAt;
        })();
      if (ownerGone) {
        write(info.epoch + 1, true);
        return { kind: "granted", epoch: info.epoch + 1 };
      }
    }
    return { kind: "active", owner: info };
  };

  const renewNow = (token: LeaseToken): Result<void, LeaseError> => {
    const now = clock.now();
    const written = db.write((tx): boolean => {
      const changed = tx.run(
        `UPDATE sys_leases SET heartbeat_at = ?, expires_at = ?
         WHERE resource = ? AND holder_id = ? AND epoch = ? AND released_at IS NULL`,
        [now, now + settings.leaseTtlMs, token.resource, token.holderId, token.epoch],
      );
      return changed.changes === 1;
    });
    if (!written.ok) return err(mapWriteError(written.error));
    if (!written.value) {
      dropOwned(token);
      return err({ kind: "lease_lost", resource: token.resource });
    }
    return ok(undefined);
  };

  const releaseNow = (token: LeaseToken): Result<void, LeaseError> => {
    const now = clock.now();
    const written = db.write((tx): void => {
      tx.run(
        `UPDATE sys_leases SET released_at = ?
         WHERE resource = ? AND holder_id = ? AND epoch = ? AND released_at IS NULL`,
        [now, token.resource, token.holderId, token.epoch],
      );
    });
    if (!written.ok) return err(mapWriteError(written.error));
    dropOwned(token);
    return ok(undefined);
  };

  return {
    acquire(resource: LeaseResource, holder: LeaseHolder): Result<LeaseToken, LeaseError> {
      if (!LEASE_RESOURCE.test(resource)) {
        throw new Bug(`store.lease_resource_invalid: ${resource}`);
      }
      assertNotInWrite(conn.state, "leases.acquire");
      assertOpen();
      // OS 잠금이 없는 provider(none)는 프로세스 안 보유 표를 쓰지 않고 DB 행 판정으로 간다
      const prior = locks.kind === "none" ? undefined : owned.get(resource);
      let handle: LockHandle;
      let fresh = false;
      if (prior !== undefined) {
        // 이 프로세스가 이미 쥔 자원. 같은 holder면 임대만 갱신하고 다른 holder면 OS 잠금 경합과 같다
        if (prior.holderId !== holder.holderId) {
          return err({
            kind: "lock_busy",
            resource,
            reason: "os_lock_held",
            owner: readOwner(resource),
          });
        }
        handle = prior.handle;
      } else {
        const got = locks.tryAcquire(resource);
        if (!got.ok) {
          switch (got.error.kind) {
            case "held":
              return err({
                kind: "lock_busy",
                resource,
                reason: "os_lock_held",
                owner: readOwner(resource),
              });
            case "unsupported":
              return err({ kind: "lock_io", code: "unsupported" });
            case "io":
              return err({ kind: "lock_io", code: got.error.code });
            default:
              throw new Bug("store.lock_error_invalid");
          }
        }
        handle = got.value;
        fresh = true;
      }
      try {
        if (fresh) faults.hit("lease_after_os_lock");
        const now = clock.now();
        const written = db.write((tx): Decision => {
          const decision = decide(tx, resource, holder, now);
          faults.hit("lease_before_commit");
          return decision;
        });
        if (!written.ok) {
          if (fresh) handle.release();
          return err(mapWriteError(written.error));
        }
        const decision = written.value;
        if (decision.kind === "row_invalid") {
          if (fresh) handle.release();
          return err(decision.fault);
        }
        if (decision.kind === "active") {
          if (fresh) handle.release();
          return err({
            kind: "lock_busy",
            resource,
            reason: "lease_active",
            owner: decision.owner,
          });
        }
        owned.set(resource, { holderId: holder.holderId, epoch: decision.epoch, handle });
        return ok({ resource, holderId: holder.holderId, epoch: decision.epoch });
      } catch (caught) {
        if (fresh) handle.release();
        throw caught;
      }
    },
    renew(token: LeaseToken): Result<void, LeaseError> {
      assertNotInWrite(conn.state, "leases.renew");
      assertOpen();
      return renewNow(token);
    },
    release(token: LeaseToken): Result<void, LeaseError> {
      assertNotInWrite(conn.state, "leases.release");
      assertOpen();
      return releaseNow(token);
    },
    holds(tx: SqlTx, token: LeaseToken): Result<boolean, LeaseRowInvalid> {
      // 캐시를 쓰지 않고 같은 트랜잭션에서 행을 새로 읽는다. 시각을 비교하지 않는다(TX-10)
      const row = tx.get(
        "SELECT holder_id, epoch, released_at FROM sys_leases WHERE resource = ?",
        [token.resource],
      );
      if (row === undefined) return ok(false);
      const c = leaseColumns(row);
      const holderId = c.string("holder_id");
      if (!holderId.ok) return holderId;
      const epoch = c.int("epoch");
      if (!epoch.ok) return epoch;
      const releasedAt = c.nullableInt("released_at");
      if (!releasedAt.ok) return releasedAt;
      return ok(
        holderId.value === token.holderId &&
          epoch.value === token.epoch &&
          releasedAt.value === null,
      );
    },
    inspect(
      resource: LeaseResource,
    ): Result<LeaseOwnerInfo | null, { readonly kind: "busy" } | LeaseRowInvalid> {
      const read = db.read((tx) => tx.get(SELECT_LEASE, [resource]));
      if (!read.ok) return err({ kind: "busy" });
      if (read.value === undefined) return ok(null);
      return liveOwnerOf(read.value);
    },
    keepAlive(token: LeaseToken, onLost: (resource: LeaseResource) => void): Disposable {
      let timer: TimerHandle | undefined;
      let stopped = false;
      let failingSince: number | null = null;
      const stop = (): void => {
        stopped = true;
        if (timer !== undefined) scheduler.clearTimeout(timer);
        timer = undefined;
        alarms.delete(alarm);
      };
      const schedule = (): void => {
        timer = scheduler.setTimeout(tick, settings.heartbeatMs);
      };
      const tick = (): void => {
        timer = undefined;
        if (stopped) return;
        const renewed = renewNow(token);
        if (renewed.ok) {
          failingSince = null;
          schedule();
          return;
        }
        if (renewed.error.kind === "lease_lost") {
          stop();
          onLost(token.resource);
          return;
        }
        // busy 등 일시 실패는 다음 주기에 다시 시도한다. 연속 실패가 TTL을 넘으면 잃은 것으로 본다
        const now = clock.now();
        failingSince ??= now;
        if (now - failingSince > settings.leaseTtlMs) {
          stop();
          onLost(token.resource);
          return;
        }
        schedule();
      };
      const alarm: Disposable = { [Symbol.dispose]: stop };
      alarms.add(alarm);
      schedule();
      return alarm;
    },
    releaseAll(): void {
      for (const alarm of alarms) alarm[Symbol.dispose]();
      for (const [resource, entry] of owned) {
        const token: LeaseToken = { resource, holderId: entry.holderId, epoch: entry.epoch };
        const released = releaseNow(token);
        // 반납 쓰기가 실패해도 OS 잠금은 푼다. DB 행은 만료(leaseTtlMs)로 정리된다
        if (!released.ok) dropOwned(token);
      }
    },
  };
}
