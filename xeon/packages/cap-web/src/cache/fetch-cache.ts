import { err, ok, parse, parseJson, type Clock, type Result } from "@xeon/contracts";
import {
  BlobRefSchema,
  type BlobError,
  type BlobRef,
  type MigrationError,
  type MigrationReport,
  type StoreReadError,
  type StoreWriteError,
} from "@xeon/contracts/records";
import type { WebStorePort } from "../ports/store.ts";
import { sha256Hex } from "../util/hash.ts";
import { CAP_WEB_MIGRATIONS, WEB_STORE_OWNER } from "./migrations.ts";
import { nullableStringCell, numberCell, stringCell, type RowInvalid } from "./rows.ts";

// L2.web.spec §3.8, §4.3.1 (3), §4.9.2. 디스크 fetch 캐시(`cap_web_fetch_cache`)와 원문 저장(`cap_web_raw`).
// 블롭은 트랜잭션 밖에서 저장하고(TX-04), 행 쓰기는 응답을 받은 뒤 짧은 `StoreDb.write` 하나로 한다(TX-01).
// `cap_web_raw` 행이 가리키는 원문·본문 블롭은 `cap.web` 소유로 `rawRef`에 고정한다(pinBlob, L0.store §3.4).
// 행이 지워질 때(sweep, purgeSessionRaw) 고정을 푼다. 캐시 행만 지운 경우에는 원문 행이 남으므로 고정도 남는다.

export type CacheError =
  | { readonly kind: "migrate"; readonly error: MigrationError }
  | { readonly kind: "write"; readonly error: StoreWriteError }
  | { readonly kind: "read"; readonly error: StoreReadError }
  | { readonly kind: "blob"; readonly error: BlobError }
  | { readonly kind: "row_invalid"; readonly column: string };

export type Retention = "session" | "persist";

export interface SaveInput {
  /** writeCacheRow일 때만 fetch 캐시 행의 키로 쓴다 */
  readonly cacheKey: string;
  /** 요청 URL 원문(정규화 전) */
  readonly url: string;
  readonly urlNorm: string;
  readonly finalUrl: string | undefined;
  readonly provider: string;
  readonly status: number;
  readonly contentType: string;
  readonly method: string;
  readonly title: string | undefined;
  readonly publishedAt: string | undefined;
  readonly retention: Retention;
  /** retention이 session이면 소유 세션 */
  readonly sessionId: string | undefined;
  readonly rawBytes: Uint8Array;
  /** 변환한 Markdown 또는 텍스트 */
  readonly text: string;
  readonly ttlMs: number;
  /** persist이면서 캐시 재사용을 허용할 때만 참(`freshness: "live"`나 TTL 0이면 거짓) */
  readonly writeCacheRow: boolean;
}

export interface CachedPage {
  readonly rawRef: string;
  readonly urlNorm: string;
  readonly finalUrl: string | undefined;
  readonly provider: string;
  readonly status: number;
  readonly contentType: string;
  readonly method: string;
  readonly title: string | undefined;
  readonly publishedAt: string | undefined;
  readonly retrievedAt: number;
  readonly expiresAt: number;
  readonly text: string;
  readonly rawSha256: string;
  readonly rawBytes: number;
}

export interface RawPage {
  readonly rawRef: string;
  readonly retention: Retention;
  readonly text: string;
  readonly url: string;
  readonly finalUrl: string | undefined;
  readonly provider: string;
  readonly status: number;
  readonly contentType: string;
  readonly method: string;
  readonly title: string | undefined;
  readonly publishedAt: string | undefined;
  readonly createdAt: number;
}

export interface FetchCache {
  /** 마이그레이션을 적용한다. 시작 때 한 번 */
  migrate(): Result<MigrationReport, CacheError>;
  /** 만료 전 행. 없거나 만료면 undefined */
  lookup(cacheKey: string): Result<CachedPage | undefined, CacheError>;
  save(input: SaveInput): Result<{ readonly rawRef: string }, CacheError>;
  /** rawRef 재조회. session 원문은 같은 세션만 읽는다. 없으면 undefined */
  readRaw(rawRef: string, sessionId: string | undefined): Result<RawPage | undefined, CacheError>;
  /** persist 원문 크기(원문+변환 본문 blob)가 maxBytes를 넘으면 만료가 가까운 행부터 지운다 */
  sweep(maxBytes: number): Result<{ readonly removed: number }, CacheError>;
  /** 살아 있지 않은 세션의 session 원문 행을 지운다 */
  purgeSessionRaw(
    liveSessions: ReadonlySet<string>,
  ): Result<{ readonly removed: number }, CacheError>;
}

export function cacheKeyOf(parts: {
  readonly urlNorm: string;
  readonly format: string;
  readonly render: string;
  readonly provider: string;
}): string {
  return sha256Hex([parts.urlNorm, parts.format, parts.render, parts.provider].join("|"));
}

export function rawRefOf(bytes: Uint8Array): string {
  return `webraw:${sha256Hex(bytes)}`;
}

function parseBlobRef(text: string): Result<BlobRef, CacheError> {
  const json = parseJson(text);
  if (!json.ok) return err({ kind: "row_invalid", column: "blob" });
  const ref = parse(BlobRefSchema, json.value);
  return ref.ok ? ok(ref.value) : err({ kind: "row_invalid", column: "blob" });
}

function invalid(failure: RowInvalid): CacheError {
  return failure;
}

export function createFetchCache(deps: {
  readonly store: WebStorePort;
  readonly clock: Clock;
}): FetchCache {
  const { store, clock } = deps;
  const db = (): ReturnType<WebStorePort["scoped"]> => store.scoped(WEB_STORE_OWNER);

  function readText(textBlob: string): Result<string, CacheError> {
    const ref = parseBlobRef(textBlob);
    if (!ref.ok) return ref;
    const bytes = store.readBlob(ref.value);
    if (!bytes.ok) return err({ kind: "blob", error: bytes.error });
    return ok(new TextDecoder().decode(bytes.value));
  }

  /**
   * `cap_web_raw` 한 행의 원문·본문 블롭을 `rawRef`로 고정한다. 같은 원문을 다시 저장해 본문이 바뀌었을 수 있으므로
   * 먼저 이 행의 고정을 모두 풀고 새 두 블롭을 적는다. 호출은 동기이므로 그 사이에 GC가 끼어들지 않는다.
   */
  function pinRow(rawRef: string, raw: BlobRef, text: BlobRef): Result<void, CacheError> {
    const released = store.unpinBlob(WEB_STORE_OWNER, rawRef);
    if (!released.ok) return err({ kind: "blob", error: released.error });
    const rawPin = store.pinBlob(WEB_STORE_OWNER, raw.sha256, rawRef);
    if (!rawPin.ok) return err({ kind: "blob", error: rawPin.error });
    const textPin = store.pinBlob(WEB_STORE_OWNER, text.sha256, rawRef);
    if (!textPin.ok) return err({ kind: "blob", error: textPin.error });
    return ok(undefined);
  }

  /** 지운 원문 행의 고정을 푼다. 한 개가 실패해도 나머지는 계속 풀고 처음 실패를 돌려준다(남은 고정은 블롭을 지키는 쪽이다) */
  function releaseRows(rawRefs: readonly string[]): Result<void, CacheError> {
    let failure: CacheError | undefined;
    for (const rawRef of rawRefs) {
      const released = store.unpinBlob(WEB_STORE_OWNER, rawRef);
      if (!released.ok && failure === undefined) {
        failure = { kind: "blob", error: released.error };
      }
    }
    return failure === undefined ? ok(undefined) : err(failure);
  }

  return {
    migrate() {
      const applied = store.migrations.apply(CAP_WEB_MIGRATIONS);
      return applied.ok ? applied : err({ kind: "migrate", error: applied.error });
    },

    lookup(cacheKey) {
      const now = clock.now();
      const read = db().read((tx) =>
        tx.get(
          `SELECT c.raw_ref, c.url_norm, c.final_url, c.provider, c.status, c.content_type, c.method, c.title,
                  c.published_at, c.retrieved_at, c.expires_at, r.text_blob, r.raw_blob
             FROM cap_web_fetch_cache c JOIN cap_web_raw r ON r.raw_ref = c.raw_ref
            WHERE c.cache_key = ? AND c.expires_at > ?`,
          [cacheKey, now],
        ),
      );
      if (!read.ok) return err({ kind: "read", error: read.error });
      const row = read.value;
      if (row === undefined) return ok(undefined);
      const rawRef = stringCell(row, "raw_ref");
      const urlNorm = stringCell(row, "url_norm");
      const finalUrl = nullableStringCell(row, "final_url");
      const provider = stringCell(row, "provider");
      const status = numberCell(row, "status");
      const contentType = stringCell(row, "content_type");
      const method = stringCell(row, "method");
      const title = nullableStringCell(row, "title");
      const publishedAt = nullableStringCell(row, "published_at");
      const retrievedAt = numberCell(row, "retrieved_at");
      const expiresAt = numberCell(row, "expires_at");
      const textBlob = stringCell(row, "text_blob");
      const rawBlob = stringCell(row, "raw_blob");
      if (!rawRef.ok) return err(invalid(rawRef.error));
      if (!urlNorm.ok) return err(invalid(urlNorm.error));
      if (!finalUrl.ok) return err(invalid(finalUrl.error));
      if (!provider.ok) return err(invalid(provider.error));
      if (!status.ok) return err(invalid(status.error));
      if (!contentType.ok) return err(invalid(contentType.error));
      if (!method.ok) return err(invalid(method.error));
      if (!title.ok) return err(invalid(title.error));
      if (!publishedAt.ok) return err(invalid(publishedAt.error));
      if (!retrievedAt.ok) return err(invalid(retrievedAt.error));
      if (!expiresAt.ok) return err(invalid(expiresAt.error));
      if (!textBlob.ok) return err(invalid(textBlob.error));
      if (!rawBlob.ok) return err(invalid(rawBlob.error));
      const text = readText(textBlob.value);
      if (!text.ok) return text;
      const raw = parseBlobRef(rawBlob.value);
      if (!raw.ok) return raw;
      return ok({
        rawRef: rawRef.value,
        urlNorm: urlNorm.value,
        finalUrl: finalUrl.value ?? undefined,
        provider: provider.value,
        status: status.value,
        contentType: contentType.value,
        method: method.value,
        title: title.value ?? undefined,
        publishedAt: publishedAt.value ?? undefined,
        retrievedAt: retrievedAt.value,
        expiresAt: expiresAt.value,
        text: text.value,
        rawSha256: raw.value.sha256,
        rawBytes: raw.value.size,
      });
    },

    save(input) {
      const rawRef = rawRefOf(input.rawBytes);
      // 블롭은 트랜잭션 밖에서 먼저 저장한다. 같은 해시면 파일을 다시 쓰지 않는다
      const rawBlob = store.putBlob(
        input.rawBytes,
        input.contentType === "" ? null : input.contentType.slice(0, 127),
      );
      if (!rawBlob.ok) return err({ kind: "blob", error: rawBlob.error });
      const textBlob = store.putBlob(new TextEncoder().encode(input.text), "text/markdown");
      if (!textBlob.ok) return err({ kind: "blob", error: textBlob.error });
      const now = clock.now();
      const written = db().write((tx) => {
        // 같은 원문이 이미 persist로 있으면 retention을 낮추지 않는다
        tx.run(
          `INSERT INTO cap_web_raw
             (raw_ref, retention, session_id, raw_blob, text_blob, text_chars, created_at,
              url, final_url, provider, status, content_type, method, title, published_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(raw_ref) DO UPDATE SET
             retention = CASE WHEN excluded.retention = 'persist' THEN 'persist' ELSE cap_web_raw.retention END,
             session_id = CASE WHEN excluded.retention = 'persist' THEN NULL ELSE cap_web_raw.session_id END,
             text_blob = excluded.text_blob,
             text_chars = excluded.text_chars`,
          [
            rawRef,
            input.retention,
            input.retention === "session" ? (input.sessionId ?? null) : null,
            JSON.stringify(rawBlob.value),
            JSON.stringify(textBlob.value),
            input.text.length,
            now,
            input.url,
            input.finalUrl ?? null,
            input.provider,
            input.status,
            input.contentType,
            input.method,
            input.title ?? null,
            input.publishedAt ?? null,
          ],
        );
        if (input.writeCacheRow && input.retention === "persist") {
          tx.run(
            `INSERT OR REPLACE INTO cap_web_fetch_cache
               (cache_key, url_norm, final_url, provider, status, content_type, raw_ref, method, title, published_at, retrieved_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              input.cacheKey,
              input.urlNorm,
              input.finalUrl ?? null,
              input.provider,
              input.status,
              input.contentType,
              rawRef,
              input.method,
              input.title ?? null,
              input.publishedAt ?? null,
              now,
              now + input.ttlMs,
            ],
          );
        }
      });
      if (!written.ok) return err({ kind: "write", error: written.error });
      // 행이 커밋된 뒤에 고정한다(트랜잭션 밖, TX-04). 실패하면 행은 남고 고정이 없다. 다음 저장이 다시 적는다
      const pinned = pinRow(rawRef, rawBlob.value, textBlob.value);
      if (!pinned.ok) return pinned;
      return ok({ rawRef });
    },

    readRaw(rawRef, sessionId) {
      const read = db().read((tx) =>
        tx.get(
          `SELECT retention, session_id, text_blob, created_at, url, final_url, provider, status,
                  content_type, method, title, published_at
             FROM cap_web_raw WHERE raw_ref = ?`,
          [rawRef],
        ),
      );
      if (!read.ok) return err({ kind: "read", error: read.error });
      const row = read.value;
      if (row === undefined) return ok(undefined);
      const retention = stringCell(row, "retention");
      const owner = nullableStringCell(row, "session_id");
      const textBlob = stringCell(row, "text_blob");
      const createdAt = numberCell(row, "created_at");
      const url = stringCell(row, "url");
      const finalUrl = nullableStringCell(row, "final_url");
      const provider = stringCell(row, "provider");
      const status = numberCell(row, "status");
      const contentType = stringCell(row, "content_type");
      const method = stringCell(row, "method");
      const title = nullableStringCell(row, "title");
      const publishedAt = nullableStringCell(row, "published_at");
      if (!retention.ok) return err(invalid(retention.error));
      if (!owner.ok) return err(invalid(owner.error));
      if (!textBlob.ok) return err(invalid(textBlob.error));
      if (!createdAt.ok) return err(invalid(createdAt.error));
      if (!url.ok) return err(invalid(url.error));
      if (!finalUrl.ok) return err(invalid(finalUrl.error));
      if (!provider.ok) return err(invalid(provider.error));
      if (!status.ok) return err(invalid(status.error));
      if (!contentType.ok) return err(invalid(contentType.error));
      if (!method.ok) return err(invalid(method.error));
      if (!title.ok) return err(invalid(title.error));
      if (!publishedAt.ok) return err(invalid(publishedAt.error));
      if (retention.value !== "session" && retention.value !== "persist") {
        return err({ kind: "row_invalid", column: "retention" });
      }
      // 다른 세션의 session 원문은 없는 것과 같다(not_found)
      if (retention.value === "session" && owner.value !== sessionId) return ok(undefined);
      const text = readText(textBlob.value);
      if (!text.ok) return text;
      return ok({
        rawRef,
        retention: retention.value,
        text: text.value,
        url: url.value,
        finalUrl: finalUrl.value ?? undefined,
        provider: provider.value,
        status: status.value,
        contentType: contentType.value,
        method: method.value,
        title: title.value ?? undefined,
        publishedAt: publishedAt.value ?? undefined,
        createdAt: createdAt.value,
      });
    },

    sweep(maxBytes) {
      const swept = db().write((tx) => {
        let removed = 0;
        // 이 트랜잭션이 지운 원문 행. 커밋된 뒤에 고정을 푼다
        const dropped: string[] = [];
        for (;;) {
          const total = tx.get(
            `SELECT COALESCE(SUM(json_extract(raw_blob, '$.size') + json_extract(text_blob, '$.size')), 0) AS bytes
               FROM cap_web_raw WHERE retention = 'persist'`,
          );
          const bytes = total === undefined ? 0 : Number(total["bytes"] ?? 0);
          if (bytes <= maxBytes) return { removed, dropped };
          const oldest = tx.get(
            "SELECT cache_key, raw_ref FROM cap_web_fetch_cache ORDER BY expires_at ASC LIMIT 1",
          );
          if (oldest === undefined) {
            // 캐시 행 없이 남은 persist 원문(rawRef 재조회용)은 오래된 것부터 지운다
            const orphan = tx.get(
              "SELECT raw_ref FROM cap_web_raw WHERE retention = 'persist' ORDER BY created_at ASC LIMIT 1",
            );
            if (orphan === undefined) return { removed, dropped };
            const orphanRef = String(orphan["raw_ref"]);
            tx.run("DELETE FROM cap_web_raw WHERE raw_ref = ?", [orphanRef]);
            dropped.push(orphanRef);
            removed += 1;
            continue;
          }
          const key = String(oldest["cache_key"]);
          const ref = String(oldest["raw_ref"]);
          tx.run("DELETE FROM cap_web_fetch_cache WHERE cache_key = ?", [key]);
          const others = tx.get(
            "SELECT 1 AS present FROM cap_web_fetch_cache WHERE raw_ref = ? LIMIT 1",
            [ref],
          );
          if (others === undefined) {
            tx.run("DELETE FROM cap_web_raw WHERE raw_ref = ?", [ref]);
            dropped.push(ref);
          }
          removed += 1;
        }
      });
      if (!swept.ok) return err({ kind: "write", error: swept.error });
      const released = releaseRows(swept.value.dropped);
      if (!released.ok) return released;
      return ok({ removed: swept.value.removed });
    },

    purgeSessionRaw(liveSessions) {
      const purged = db().write((tx) => {
        const rows = tx.all(
          "SELECT raw_ref, session_id FROM cap_web_raw WHERE retention = 'session'",
        );
        let removed = 0;
        const dropped: string[] = [];
        for (const row of rows) {
          const owner = row["session_id"];
          if (typeof owner === "string" && liveSessions.has(owner)) continue;
          const rawRef = String(row["raw_ref"]);
          tx.run("DELETE FROM cap_web_raw WHERE raw_ref = ?", [rawRef]);
          dropped.push(rawRef);
          removed += 1;
        }
        return { removed, dropped };
      });
      if (!purged.ok) return err({ kind: "write", error: purged.error });
      const released = releaseRows(purged.value.dropped);
      if (!released.ok) return released;
      return ok({ removed: purged.value.removed });
    },
  };
}
