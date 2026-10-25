import { assertNever, type Result } from "@xeon/contracts";
import type { SecretError, SecretMetaPatch } from "@xeon/contracts/services";
import {
  wireError,
  type SecretListEntry,
  type WireHandler,
  type WireHandlers,
} from "@xeon/contracts/wire";
import { handleOf, listEntryOf, wireErrorOfSecret } from "../secrets/wire.ts";
import type { Engine } from "../types.ts";
import { notImplemented } from "./not-implemented.ts";

// F.wire-settings.spec §3.3.1 secret.*, L4.host-service.spec §3.4 M2 표. 요청·응답·이벤트·오류 어디에도 값이 없다.
// 값 입력과 열람은 CLI가 wire 밖으로 맡긴 수단(SecretOutOfBandPort)을 꺼내 SecretAdminService에 넘긴다.
// 맡긴 수단이 없으면(서비스 접속, 또는 CLI가 맡기지 않음) started: false다.

type SecretMethod =
  | "secret.list"
  | "secret.meta"
  | "secret.remove"
  | "secret.test"
  | "secret.references"
  | "secret.beginEntry"
  | "secret.beginReveal";

function orThrow<T>(result: Result<T, SecretError>, where: string): T {
  if (!result.ok) throw wireErrorOfSecret(result.error, where);
  return result.value;
}

function createListHandler(engine: Engine): WireHandler<"secret.list"> {
  const { admin } = engine.ports.secrets;
  const { log } = engine.ports;
  return async (params) => {
    const listings = orThrow(await admin.ls({ usage: params.usage === true }), "secret.list");
    const secrets: SecretListEntry[] = [];
    for (const listing of listings) {
      const entry = listEntryOf(listing, params.meta === true);
      if (entry === undefined) {
        // 이름 규칙에 맞지 않는 제공자 항목은 wire 이름으로 나타낼 수 없다
        log.info("secret.list_skipped", { status: listing.status });
        continue;
      }
      secrets.push(entry);
    }
    return { secrets };
  };
}

function createMetaHandler(engine: Engine): WireHandler<"secret.meta"> {
  const { admin } = engine.ports.secrets;
  return async (params) => {
    const handle = handleOf(params.name);
    const patch: SecretMetaPatch = {
      ...(params.desc === undefined ? {} : { desc: params.desc }),
      ...(params.scope === undefined ? {} : { scope: params.scope }),
      ...(params.expiresAt === undefined ? {} : { expiresAt: params.expiresAt }),
      ...(params.use === undefined ? {} : { use: params.use }),
      ...(params.approval === undefined ? {} : { approval: params.approval }),
      ...(params.ttlSeconds === undefined ? {} : { ttlSeconds: params.ttlSeconds }),
      ...(params.maxUses === undefined ? {} : { maxUses: params.maxUses }),
    };
    const patched = orThrow(await admin.meta(handle, patch), "secret.meta");
    // 결과는 목록과 같은 모양이다: 바뀐 메타에 제공자 쪽 상태(status)를 붙인다
    const listings = orThrow(await admin.ls({ usage: false }), "secret.meta status");
    const found = listings.find((listing) => listing.handle === handle);
    const entry = found === undefined ? undefined : listEntryOf({ ...found, meta: patched }, true);
    if (entry === undefined) {
      throw wireError("internal", { message: "secret.meta: the patched secret is not listed" });
    }
    return { secret: entry };
  };
}

function createRemoveHandler(engine: Engine): WireHandler<"secret.remove"> {
  const { admin } = engine.ports.secrets;
  return async (params) => {
    const removed = await admin.rm(handleOf(params.name), { confirmed: true });
    if (removed.ok) return { removed: true };
    // 없는 이름을 지우는 요청은 이미 원하는 상태다
    if (removed.error.kind === "secret_missing" && removed.error.where === "meta") {
      return { removed: false };
    }
    throw wireErrorOfSecret(removed.error, "secret.remove");
  };
}

function createTestHandler(engine: Engine): WireHandler<"secret.test"> {
  const { admin } = engine.ports.secrets;
  return async (params) => {
    const tested = await admin.test(handleOf(params.name));
    if (tested.ok) {
      const { exists, decryptable, length, sha256Prefix } = tested.value;
      return { state: exists ? "registered" : "missing", decryptable, length, sha256Prefix };
    }
    if (tested.error.kind === "secret_missing") {
      return { state: "missing", decryptable: false, length: null, sha256Prefix: null };
    }
    throw wireErrorOfSecret(tested.error, "secret.test");
  };
}

function createBeginEntryHandler(engine: Engine): WireHandler<"secret.beginEntry"> {
  const { secrets, log } = engine.ports;
  const { admin, offers } = secrets;
  return async (params) => {
    const offer = offers.takeEntry(params.name, params.action);
    if (offer === undefined) return { started: false };
    const handle = handleOf(params.name);
    log.info("secret.entry", { name: params.name, action: params.action });
    let outcome: Result<unknown, SecretError>;
    switch (params.action) {
      case "add": {
        const meta = secrets.newMeta(params.name);
        if (meta === undefined) {
          // 값을 놓을 SOPS 파일이 설정에 없다(l0.secrets.sops.files)
          throw wireErrorOfSecret(
            { kind: "provider_unavailable", provider: "sops", reason: "not_registered" },
            "secret.beginEntry",
          );
        }
        outcome = await admin.add(meta, offer.source);
        break;
      }
      case "set":
        outcome = await admin.set(handle, offer.source);
        break;
      case "rotate":
        outcome = await admin.rotate(handle, offer.source);
        break;
      default:
        return assertNever(params.action, "SecretEntryAction");
    }
    if (outcome.ok) return { started: true };
    // 사람이 입력을 취소했다. 아무것도 저장되지 않았다
    if (outcome.error.kind === "cancelled") return { started: false };
    throw wireErrorOfSecret(outcome.error, "secret.beginEntry");
  };
}

function createBeginRevealHandler(engine: Engine): WireHandler<"secret.beginReveal"> {
  const { admin, offers } = engine.ports.secrets;
  const { log } = engine.ports;
  return async (params) => {
    const offer = offers.takeReveal(params.name);
    if (offer === undefined) return { started: false };
    log.info("secret.reveal", { name: params.name });
    const shown = await admin.reveal(handleOf(params.name), offer.reauth, offer.show);
    if (shown.ok) return { started: true };
    // 사람 확인이 끝나지 않았거나 만료됐다
    if (shown.error.kind === "reauth_required") return { started: false };
    throw wireErrorOfSecret(shown.error, "secret.beginReveal");
  };
}

export function createSecretHandlers(engine: Engine): Pick<WireHandlers, SecretMethod> {
  return {
    "secret.list": createListHandler(engine),
    "secret.meta": createMetaHandler(engine),
    "secret.remove": createRemoveHandler(engine),
    "secret.test": createTestHandler(engine),
    // G1-07: wire 계약만 있고 처리기는 HOST 트랙이 SecretAdminService.references에 잇는다
    "secret.references": notImplemented("secret.references"),
    "secret.beginEntry": createBeginEntryHandler(engine),
    "secret.beginReveal": createBeginRevealHandler(engine),
  };
}
