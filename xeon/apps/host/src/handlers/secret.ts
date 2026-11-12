import { assertNever, type Result } from "@fresnel/contracts";
import type { SecretEntryMeta, SecretMeta } from "@fresnel/contracts/capabilities";
import { isId, type ThreadId } from "@fresnel/contracts/conversation";
import type { SecretError, SecretMetaPatch, SecretValueSource } from "@fresnel/contracts/services";
import {
  wireError,
  type SecretListEntry,
  type WireError,
  type WireHandler,
  type WireHandlers,
  type WireRequestContext,
} from "@fresnel/contracts/wire";
import type { ConnectionHub } from "../connection-types.ts";
import { checkChannel, revealChannel, sourceOfChannel } from "../secrets/channel.ts";
import { auditEntriesOf, handleOf, listEntryOf, wireErrorOfSecret } from "../secrets/wire.ts";
import type { Engine } from "../types.ts";

// F.wire-settings.spec §3.3.1 secret.*, L4.host-service.spec §3.4 M2 표. 요청·응답·이벤트·오류 어디에도 값이 없다.
// 값 입력과 열람은 두 길 중 하나로 한다. (1) in-process: CLI가 wire 밖으로 맡긴 수단(SecretOutOfBandPort)을 꺼내 쓴다.
// (2) 같은 컴퓨터의 서비스 접속: 요청이 든 `channel`(CLI가 연 로컬 일회용 소켓, secrets/channel.ts)에서 읽거나 쓴다.
// 맡긴 수단도 채널도 없으면 started: false다.

type SecretMethod =
  | "secret.list"
  | "secret.meta"
  | "secret.remove"
  | "secret.test"
  | "secret.references"
  | "secret.audit"
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

/** wire 결과의 상한(F wire `SecretReferencesResult`): 설정 키 256, 최근 thread 100 */
const REFERENCES_KEYS_MAX = 256;
const REFERENCES_SESSIONS_MAX = 100;

/**
 * 삭제 전에 이 시크릿을 가리키는 곳을 보인다(`L0.secrets` `references`, `L4.cli.spec` §4.7 `secret rm`). 읽기 전용이다.
 * 알 수 없는 이름은 `secret.notFound`다. 최근 사용 thread에서 thread id 모양이 아닌 항목은 뺀다
 */
function createReferencesHandler(engine: Engine): WireHandler<"secret.references"> {
  const { admin } = engine.ports.secrets;
  return async (params) => {
    const report = orThrow(await admin.references(handleOf(params.name)), "secret.references");
    const sessions: ThreadId[] = report.sessions.filter((id): id is ThreadId => isId("thr", id));
    return {
      settingKeys: report.settingKeys.slice(0, REFERENCES_KEYS_MAX),
      activeLeases: report.activeLeases,
      sessions: sessions.slice(0, REFERENCES_SESSIONS_MAX),
    };
  };
}

/**
 * 시크릿 하나의 사용·거절 기록(`L0.secrets` `usage`, F.wire-settings.spec §3.3.1 `secret.audit`). 읽기 전용이다.
 * 알 수 없는 이름은 `secret.notFound`다. 기록 개수 상한은 없고 `limit`을 줄 때만 자른다
 */
function createAuditHandler(engine: Engine): WireHandler<"secret.audit"> {
  const { admin } = engine.ports.secrets;
  return async (params) => {
    const records = orThrow(await admin.usage(handleOf(params.name), {}), "secret.audit");
    return { entries: auditEntriesOf(records, params.limit) };
  };
}

/**
 * `secret.beginEntry`가 보낸 메타(`SecretEntryMeta`, M3-REQ-17)의 필드만 기본 메타 위에 덮는다. 보내지 않은 필드는 기본값이다.
 * 메타에는 값이 없다. 값은 맡긴 입력 수단으로 따로 들어온다
 */
function withEntryMeta(defaults: SecretMeta, supplied: SecretEntryMeta | undefined): SecretMeta {
  if (supplied === undefined) return defaults;
  return {
    ...defaults,
    ...(supplied.desc === undefined ? {} : { desc: supplied.desc }),
    ...(supplied.scope === undefined ? {} : { scope: supplied.scope }),
    ...(supplied.expiresAt === undefined ? {} : { expiresAt: supplied.expiresAt }),
    ...(supplied.use === undefined ? {} : { use: supplied.use }),
    ...(supplied.approval === undefined ? {} : { approval: supplied.approval }),
    ...(supplied.ttlSeconds === undefined ? {} : { ttlSeconds: supplied.ttlSeconds }),
    ...(supplied.maxUses === undefined ? {} : { maxUses: supplied.maxUses }),
  };
}

/** 같은 컴퓨터·같은 사용자의 연결이 아니면 거절한다. 원격 표시(`origin: "remote"`)나 연결 상태를 찾지 못한 경우가 여기 든다 */
function localOnly(where: string): WireError {
  return wireError("secret.localOnly", {
    message: `${where}: only a connection on this computer can carry the value`,
  });
}

/**
 * 요청이 보낸 `channel`을 확인한다. 원격이거나 채널이 이 사용자 것이 아니면 `secret.localOnly`를 던진다. 통과하면 경로다
 * (L4.cli.spec §4.7). 경로 자체는 값이 아니므로 로그에 남긴다
 */
async function localChannelOf(
  engine: Engine,
  hub: ConnectionHub,
  context: WireRequestContext,
  channel: string,
  where: string,
): Promise<string> {
  const client = hub.state(context.connectionId)?.client;
  if (client === undefined || client.origin !== "local") {
    engine.ports.log.info("secret.channel_refused", { where, reason: "not_local" });
    throw localOnly(where);
  }
  const checked = await checkChannel(channel);
  if (!checked.ok) {
    engine.ports.log.info("secret.channel_refused", { where, reason: checked.error });
    throw localOnly(where);
  }
  return checked.value;
}

/** 입력이 없었음(취소나 빈 값)을 기억하는 감싸기. 그때 실패는 값 검사가 아니라 사람이 넣지 않은 것이다 */
function withholdTracked(source: SecretValueSource): {
  readonly source: SecretValueSource;
  readonly withheld: () => boolean;
} {
  const state = { withheld: false };
  return {
    source: {
      async read() {
        const read = await source.read();
        if (!read.ok) state.withheld = true;
        return read;
      },
    },
    withheld: () => state.withheld,
  };
}

function createBeginEntryHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"secret.beginEntry"> {
  const { secrets, log } = engine.ports;
  const { admin, offers } = secrets;
  return async (params, context) => {
    const offer = offers.takeEntry(params.name, params.action);
    let input: SecretValueSource;
    if (offer !== undefined) {
      input = offer.source;
    } else if (params.channel !== undefined) {
      const path = await localChannelOf(
        engine,
        hub(),
        context,
        params.channel,
        "secret.beginEntry",
      );
      input = sourceOfChannel(path, context.signal);
    } else {
      return { started: false };
    }
    const tracked = withholdTracked(input);
    const handle = handleOf(params.name);
    log.info("secret.entry", { name: params.name, action: params.action });
    let outcome: Result<unknown, SecretError>;
    switch (params.action) {
      case "add": {
        const defaults = secrets.newMeta(params.name);
        if (defaults === undefined) {
          // 기본 제공자가 sops가 아니라 값을 놓을 곳을 정할 수 없다(l0.secrets.defaultProvider). SOPS 파일이 없는 경우는
          // 기본 파일이 채워지고 첫 쓰기가 만든다(L0.secrets.spec §4.8)
          throw wireErrorOfSecret(
            { kind: "provider_unavailable", provider: "sops", reason: "not_registered" },
            "secret.beginEntry",
          );
        }
        // set·rotate는 메타를 새로 만들지 않으므로 보낸 메타를 쓰지 않는다
        outcome = await admin.add(withEntryMeta(defaults, params.meta), tracked.source);
        break;
      }
      case "set":
        outcome = await admin.set(handle, tracked.source);
        break;
      case "rotate":
        outcome = await admin.rotate(handle, tracked.source);
        break;
      default:
        return assertNever(params.action, "SecretEntryAction");
    }
    if (outcome.ok) return { started: true };
    // 사람이 입력을 취소했거나 빈 값으로 닫았다. 아무것도 저장되지 않았다
    if (outcome.error.kind === "cancelled" || tracked.withheld()) return { started: false };
    throw wireErrorOfSecret(outcome.error, "secret.beginEntry");
  };
}

function createBeginRevealHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"secret.beginReveal"> {
  const { admin, offers } = engine.ports.secrets;
  const { log, clock } = engine.ports;
  return async (params, context) => {
    const offer = offers.takeReveal(params.name);
    if (offer !== undefined) {
      log.info("secret.reveal", { name: params.name });
      const shown = await admin.reveal(handleOf(params.name), offer.reauth, offer.show);
      return revealOutcome(shown);
    }
    if (params.channel === undefined) return { started: false };
    const path = await localChannelOf(engine, hub(), context, params.channel, "secret.beginReveal");
    // CLI가 터미널에서 이름을 다시 입력받아 사람을 확인했다는 표시가 없으면 열람하지 않는다
    if (params.reauth !== "tty-confirm") return { started: false };
    const delivery = revealChannel(path);
    log.info("secret.reveal", { name: params.name });
    const shown = await admin.reveal(
      handleOf(params.name),
      { method: "tty-confirm", verifiedAt: clock.now() },
      delivery.show,
    );
    if (!shown.ok) return revealOutcome(shown);
    // 기록은 보이기 전에 남는다. 채널에 쓰지 못했으면 값이 보이지 않았다
    return { started: delivery.delivered() };
  };
}

function revealOutcome(shown: Result<void, SecretError>): { started: boolean } {
  if (shown.ok) return { started: true };
  // 사람 확인이 끝나지 않았거나 만료됐다
  if (shown.error.kind === "reauth_required") return { started: false };
  throw wireErrorOfSecret(shown.error, "secret.beginReveal");
}

export function createSecretHandlers(
  engine: Engine,
  hub: () => ConnectionHub,
): Pick<WireHandlers, SecretMethod> {
  return {
    "secret.list": createListHandler(engine),
    "secret.meta": createMetaHandler(engine),
    "secret.remove": createRemoveHandler(engine),
    "secret.test": createTestHandler(engine),
    "secret.references": createReferencesHandler(engine),
    "secret.audit": createAuditHandler(engine),
    "secret.beginEntry": createBeginEntryHandler(engine, hub),
    "secret.beginReveal": createBeginRevealHandler(engine, hub),
  };
}
