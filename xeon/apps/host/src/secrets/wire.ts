import { assertNever, attempt, parse } from "@xeon/contracts";
import {
  parseSecretRef,
  SecretNameSchema,
  type SecretHandle,
  type SecretMeta,
  type SecretName,
} from "@xeon/contracts/capabilities";
import type { SecretError, SecretListing } from "@xeon/contracts/services";
import { wireError, type SecretListEntry, type WireError } from "@xeon/contracts/wire";

// F.wire-settings.spec §3.3.1 secret.*. L0.secrets의 목록·오류를 값 없는 와이어 모양으로 옮기는 순수 함수들.
// 어느 필드에도 값을 싣지 않는다. 오류는 종류와 안전한 필드(이름, 제공자, 사유 코드)만 details에 싣는다.

/** SecretName으로 검사한 핸들. 이름은 와이어 검증을 이미 통과했으므로 실패하면 호출한 쪽 결함이 아니라 잘못된 입력이다 */
export function handleOf(name: SecretName): SecretHandle {
  const parsed = parseSecretRef(`secret://${name}`);
  if (!parsed.ok) {
    // 와이어 스키마(SecretNameSchema)가 같은 패턴을 이미 검사했으므로 여기에 오는 입력은 없다
    throw wireError("jsonrpc.invalidParams", {
      details: { issues: [{ path: "name", message: "not a secret name" }] },
    });
  }
  return parsed.value.handle;
}

/**
 * 목록 항목의 이름. 메타가 있으면 메타의 이름이다. 메타 없는 제공자 항목(orphaned)은 ref의 마지막 조각을 이름 규칙에 맞춰 옮긴다
 * (`dev/GITHUB_TOKEN` → `github-token`). 규칙에 맞지 않으면 undefined다.
 */
export function listingName(listing: SecretListing): SecretName | undefined {
  if (listing.meta !== null) return listing.meta.name;
  const ref = listing.entry?.ref;
  if (ref === undefined) return undefined;
  const last = ref.split("/").pop() ?? "";
  const candidate = last.toLowerCase().replaceAll("_", "-");
  const parsed = parse(SecretNameSchema, candidate);
  return parsed.ok ? parsed.value : undefined;
}

function isoOf(ms: number): string | undefined {
  const converted = attempt(() => new Date(ms).toISOString());
  return converted.ok ? converted.value : undefined;
}

/** 메타 → 와이어 모양. 서비스 타입은 읽기 전용 배열이고 와이어 타입은 가변 배열이라 복사한다 */
export function wireMetaOf(meta: SecretMeta): NonNullable<SecretListEntry["meta"]> {
  const { use } = meta;
  return {
    name: meta.name,
    desc: meta.desc,
    provider: meta.provider,
    ref: meta.ref,
    scope: meta.scope,
    expiresAt: meta.expiresAt,
    use: {
      modes: [...use.modes],
      tools: [...use.tools],
      hosts: [...use.hosts],
      ...(use.origins === undefined ? {} : { origins: [...use.origins] }),
      ...(use.commands === undefined ? {} : { commands: [...use.commands] }),
    },
    approval: meta.approval,
    ttlSeconds: meta.ttlSeconds,
    maxUses: meta.maxUses,
  };
}

/** 목록 항목 → 와이어 항목. 이름을 정할 수 없는 항목은 undefined다 */
export function listEntryOf(
  listing: SecretListing,
  withMeta: boolean,
): SecretListEntry | undefined {
  const name = listingName(listing);
  if (name === undefined) return undefined;
  const lastUsedAt = listing.lastUsedAt === null ? undefined : isoOf(listing.lastUsedAt);
  return {
    name,
    status: listing.status,
    ...(withMeta && listing.meta !== null ? { meta: wireMetaOf(listing.meta) } : {}),
    ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
  };
}

function invalidParams(path: string, message: string): WireError {
  return wireError("jsonrpc.invalidParams", { details: { issues: [{ path, message }] } });
}

/** F 오류 표에는 비밀 관리 전용 kind가 아직 없다. 입력 문제는 -32602로, 나머지는 kind를 details에 실은 internal로 알린다 */
export function wireErrorOfSecret(error: SecretError, where: string): WireError {
  switch (error.kind) {
    case "invalid_ref":
      return invalidParams("name", `${where}: invalid reference (${error.reason})`);
    case "unsupported_ref_syntax":
      return invalidParams("name", `${where}: unsupported reference syntax (${error.syntax})`);
    case "meta_invalid":
      return wireError("jsonrpc.invalidParams", {
        message: `${where}: secret metadata is invalid`,
        details: {
          issues: error.errors.slice(0, 20).map((entry) => ({
            path: error.path.slice(0, 512),
            message: entry.slice(0, 512),
          })),
        },
      });
    case "value_too_short":
      return invalidParams(
        "value",
        `${where}: value is shorter than ${String(error.minBytes)} bytes`,
      );
    case "secret_missing":
      return secretFailure(error.kind, where, { where: error.where });
    case "denied":
      return secretFailure(error.kind, where, { reason: error.reason });
    case "provider_unavailable":
      return secretFailure(error.kind, where, { provider: error.provider, reason: error.reason });
    case "key_unavailable":
      return secretFailure(error.kind, where, { key: error.key, reason: error.reason });
    case "decrypt_failed":
      // stderrMasked는 마스킹을 거쳤지만 외부 도구의 출력이다. 응답에 싣지 않는다
      return secretFailure(error.kind, where, {
        provider: error.provider,
        exitCode: error.exitCode,
      });
    case "in_use":
      return secretFailure(error.kind, where, { activeLeases: error.activeLeases });
    case "already_exists":
      return secretFailure(error.kind, where, {});
    case "read_only_provider":
      return secretFailure(error.kind, where, { provider: error.provider });
    case "reauth_required":
    case "cancelled":
      return secretFailure(error.kind, where, {});
    case "audit_unwritable":
      return secretFailure(error.kind, where, { code: error.code });
    case "write_failed":
      return secretFailure(error.kind, where, { target: error.target, code: error.code });
    default:
      return assertNever(error, "SecretError");
  }
}

function secretFailure(
  kind: SecretError["kind"],
  where: string,
  fields: Readonly<Record<string, unknown>>,
): WireError {
  return wireError("internal", {
    message: `${where}: ${kind}`,
    details: { secret: { kind, ...fields } },
  });
}
