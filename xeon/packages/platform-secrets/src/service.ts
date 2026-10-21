import { err, ok, type Clock, type Logger, type Result, type Scheduler } from "@xeon/contracts";
import type {
  RedactionHit,
  SecretAuditRecord,
  SecretHandle,
  SecretMeta,
  SecretName,
  SecretProviderId,
} from "@xeon/contracts/capabilities";
import type {
  ApprovalEvidence,
  ConcreteHttpRequest,
  HttpResponseLike,
  HttpTemplate,
  ProviderEntry,
  Redactor,
  SecretDiagnostics,
  SecretError,
  SecretLease,
  SecretListing,
  SecretProvider,
  SecretService,
  SecretStatus,
  SecretValueView,
  UseCtx,
  UseDecision,
} from "@xeon/contracts/services";
import { approvedRecord, createAuditBus, deniedRecord, maskedRecord, usedRecord } from "./audit.ts";
import { assembleDiagnostics, providerRow } from "./diagnose.ts";
import { deniedError } from "./errors.ts";
import { wrapLease } from "./lease.ts";
import type { MetaStore } from "./meta.ts";
import { evaluatePolicy, isMetaExpired, isMetaExpiring, type PolicyOutcome } from "./policy.ts";
import { findHandleTokens, parseHandle } from "./ref.ts";

// L0.secrets.spec §3.6, §4.1~§4.4. 서비스 조립: resolve, list, check, lease(판정 → 제공자 → 등록 → 감사),
// withEnv(사용 모드 env, 마일스톤 M1), withHttp(사용 모드 runtime-http).

interface DiagnoseParts {
  readonly sops: SecretDiagnostics["sops"];
  readonly key: SecretDiagnostics["key"];
  readonly fileFallbackNotice: boolean;
  readonly unconfirmedFallback: boolean;
}

export interface SecretServiceCoreDeps {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  /** 기본 TTL·횟수(l0.secrets.lease.*). 호출마다 읽는다 */
  readonly limits: () => { readonly ttlSeconds: number; readonly maxUses: number };
  readonly meta: MetaStore;
  /** 내장 제공자. registerProvider로 교체할 수 없다 */
  readonly providers: readonly SecretProvider[];
  readonly redactor: Redactor;
  readonly protectedPaths: () => readonly string[];
  readonly diagnoseParts: () => Promise<DiagnoseParts>;
  /** l0.secrets.providers */
  readonly configuredProviders: () => readonly SecretProviderId[];
}

export interface SecretServiceRuntime extends SecretService, Disposable {
  /** 핸들의 활성 lease를 모두 닫고 개수를 돌려준다(rotate·rm, 마일스톤 M2 관리 서비스가 쓴다) */
  revokeLeases(handle: SecretHandle): number;
  activeLeaseCount(handle: SecretHandle): number;
}

interface Authorized {
  readonly handle: SecretHandle;
  readonly name: SecretName;
  readonly meta: SecretMeta;
  readonly evidence: ApprovalEvidence | null;
}

const SEEN_LIMIT = 4096;
const HEADER_SHAPE = /^(?:(\S+)\s+)?(secret:\/\/\S+)$/;
const SHORT_VALUE_MODES: ReadonlySet<string> = new Set(["runtime-http", "browser-input"]);

function remember(set: Set<string>, key: string): void {
  set.add(key);
  if (set.size > SEEN_LIMIT) {
    const oldest = set.values().next();
    if (!oldest.done) set.delete(oldest.value);
  }
}

function invalidRef(reason: "scheme" | "trailing"): SecretError {
  return { kind: "invalid_ref", reason };
}

function targetPort(url: URL): number {
  if (url.port !== "") return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

// ── withHttp 도우미 ─────────────────────────────────────────────────────

interface HttpPlan {
  readonly url: URL;
  readonly handles: readonly SecretHandle[];
}

function planHttp(template: HttpTemplate): Result<HttpPlan, SecretError> {
  let url: URL;
  try {
    url = new URL(template.url);
  } catch {
    return err(invalidRef("scheme"));
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || template.url.includes("secret:")) {
    // URL에는 핸들을 넣을 수 없다(쿼리 문자열은 로그와 리퍼러로 새기 쉽다)
    return err(invalidRef("scheme"));
  }
  const found = new Set<SecretHandle>();
  for (const value of Object.values(template.headers)) {
    const tokens = findHandleTokens(value);
    if (tokens.length === 0) continue;
    const shape = HEADER_SHAPE.exec(value);
    const token = shape?.[2];
    if (tokens.length !== 1 || token === undefined) return err(invalidRef("trailing"));
    const parsed = parseHandle(token);
    if (!parsed.ok) return err(parsed.error);
    found.add(parsed.value.handle);
  }
  if (typeof template.body === "string") {
    for (const token of findHandleTokens(template.body)) {
      const parsed = parseHandle(token);
      if (!parsed.ok) return err(parsed.error);
      found.add(parsed.value.handle);
    }
  }
  return ok({ url, handles: [...found] });
}

function substitute(text: string, values: ReadonlyMap<SecretHandle, string>): string {
  let out = text;
  for (const [handle, value] of values) out = out.replaceAll(handle, () => value);
  return out;
}

function disposeAll(leases: Iterable<SecretLease>): void {
  for (const lease of leases) lease.dispose();
}

export function createSecretServiceCore(deps: SecretServiceCoreDeps): SecretServiceRuntime {
  const { clock, redactor } = deps;
  const providers = new Map<SecretProviderId, SecretProvider>();
  const builtin = new Set<SecretProviderId>();
  for (const provider of deps.providers) {
    providers.set(provider.id, provider);
    builtin.add(provider.id);
  }
  const bus = createAuditBus({ logger: deps.logger });
  const active = new Map<SecretHandle, Set<SecretLease>>();
  const usedAt = new Map<SecretHandle, number>();
  const seenApprovals = new Set<string>();
  const consumedPerUse = new Set<string>();

  function emit(record: SecretAuditRecord): void {
    if (record.type === "secret.used") usedAt.set(record.handle, record.at);
    bus.emit(record);
  }

  function activeLeases(handle: SecretHandle): SecretLease[] {
    const set = active.get(handle);
    if (set === undefined) return [];
    const now = clock.now();
    const live: SecretLease[] = [];
    for (const lease of set) {
      if (lease.usesLeft > 0 && now < lease.expiresAt) live.push(lease);
      else set.delete(lease);
    }
    return live;
  }

  // ── 메타와 정책 ────────────────────────────────────────────────────────

  async function loadMeta(
    handle: SecretHandle,
  ): Promise<Result<{ readonly name: SecretName; readonly meta: SecretMeta }, SecretError>> {
    const parsed = parseHandle(handle);
    if (!parsed.ok) return err(parsed.error);
    const entry = await deps.meta.get(parsed.value.name);
    if (entry === null) return err({ kind: "secret_missing", handle, where: "meta" });
    if (entry.kind === "invalid") return err(entry.error);
    return ok({ name: entry.name, meta: entry.meta });
  }

  function decide(handle: SecretHandle, meta: SecretMeta, ctx: UseCtx): PolicyOutcome {
    const outcome = evaluatePolicy(meta, ctx, clock.now());
    if (
      outcome.kind === "allow" &&
      outcome.approval !== null &&
      outcome.approval.scope === "per-use" &&
      consumedPerUse.has(`${outcome.approval.approvalId}|${handle}`)
    ) {
      // 실행마다 승인: 한 번 쓴 per-use 승인 증거는 다시 쓰지 못한다
      return { kind: "needs_approval", approval: "per-use" };
    }
    return outcome;
  }

  function effectiveLimits(meta: SecretMeta): { ttlSeconds: number; maxUses: number } {
    const base = deps.limits();
    return {
      ttlSeconds: Math.min(meta.ttlSeconds, base.ttlSeconds),
      maxUses: Math.min(meta.maxUses, base.maxUses),
    };
  }

  async function authorize(
    handle: SecretHandle,
    ctx: UseCtx,
  ): Promise<Result<Authorized, SecretError>> {
    const loaded = await loadMeta(handle);
    if (!loaded.ok) return loaded;
    const { name, meta } = loaded.value;
    const outcome = decide(handle, meta, ctx);
    if (outcome.kind === "allow") {
      return ok({ handle, name, meta, evidence: outcome.approval });
    }
    const reason = outcome.kind === "deny" ? outcome.reason : "approval_missing";
    emit(deniedRecord({ handle, mode: ctx.mode, reason, ctx, at: clock.now() }));
    return err(deniedError(handle, reason));
  }

  // ── lease ──────────────────────────────────────────────────────────────

  function track(handle: SecretHandle, lease: SecretLease): void {
    const set = active.get(handle) ?? new Set<SecretLease>();
    set.add(lease);
    active.set(handle, set);
  }

  async function openLease(
    auth: Authorized,
    ctx: UseCtx,
  ): Promise<Result<SecretLease, SecretError>> {
    const { handle, name, meta } = auth;
    const provider = providers.get(meta.provider);
    if (provider === undefined) {
      return err({
        kind: "provider_unavailable",
        provider: meta.provider,
        reason: "not_registered",
      });
    }
    const limits = effectiveLimits(meta);
    // 값 등록(registerKnown)이 use 한 번을 쓰므로 제공자에는 한 번 더 요청한다
    const opened = await provider.lease(meta.ref, ctx, {
      ttlSeconds: limits.ttlSeconds,
      maxUses: limits.maxUses + 1,
    });
    if (!opened.ok) {
      // 제공자는 핸들을 모른다. 없는 항목 오류에는 서비스가 실제 핸들을 채운다
      const error = opened.error;
      return error.kind === "secret_missing"
        ? err({ kind: "secret_missing", handle, where: error.where })
        : opened;
    }
    const inner = opened.value;

    const registered = await inner.use((view: SecretValueView) =>
      redactor.registerKnown(name, view.bytes),
    );
    if (!registered.ok) {
      inner.dispose();
      return registered;
    }
    if (!registered.value.ok && !SHORT_VALUE_MODES.has(ctx.mode)) {
      // 8바이트 미만 값은 가릴 수 없으므로 출력에 값이 나올 수 있는 모드에는 주지 않는다(spec §3.5)
      inner.dispose();
      emit(
        deniedRecord({ handle, mode: ctx.mode, reason: "mode_not_allowed", ctx, at: clock.now() }),
      );
      return err(deniedError(handle, "mode_not_allowed"));
    }

    const lease = wrapLease(inner, {
      handle,
      gate: () => (isMetaExpired(meta, clock.now()) ? "expired" : null),
      onClose: () => active.get(handle)?.delete(lease),
    });
    track(handle, lease);

    const evidence = auth.evidence;
    if (evidence !== null) {
      const key = `${evidence.approvalId}|${handle}`;
      if (!seenApprovals.has(key)) {
        remember(seenApprovals, key);
        emit(
          approvedRecord({ handle, approval: evidence, threadId: ctx.threadId, at: clock.now() }),
        );
      }
      if (evidence.scope === "per-use") remember(consumedPerUse, key);
    }
    emit(usedRecord({ handle, ctx, leaseId: lease.leaseId, at: clock.now() }));
    return ok(lease);
  }

  // ── 목록 ───────────────────────────────────────────────────────────────

  async function entriesByProvider(): Promise<
    Result<ReadonlyMap<SecretProviderId, readonly ProviderEntry[]>, SecretError>
  > {
    const map = new Map<SecretProviderId, readonly ProviderEntry[]>();
    const all = [...providers];
    const listed = await Promise.all(all.map(([, provider]) => provider.list()));
    for (const [index, [id]] of all.entries()) {
      const result = listed[index];
      if (result === undefined) continue;
      if (!result.ok) return result;
      map.set(id, result.value);
    }
    return ok(map);
  }

  function statusOf(meta: SecretMeta, entry: ProviderEntry | null): SecretStatus {
    if (entry === null) return "missing";
    const now = clock.now();
    if (isMetaExpired(meta, now)) return "expired";
    if (isMetaExpiring(meta, now)) return "expiring";
    return "valid";
  }

  function listingOf(
    name: SecretName,
    meta: SecretMeta,
    byProvider: ReadonlyMap<SecretProviderId, readonly ProviderEntry[]>,
  ): SecretListing {
    const parsed = parseHandle(`secret://${name}`);
    const handle = parsed.ok ? parsed.value.handle : null;
    const entry = (byProvider.get(meta.provider) ?? []).find((e) => e.ref === meta.ref) ?? null;
    return {
      meta,
      entry,
      handle,
      status: statusOf(meta, entry),
      lastUsedAt: handle === null ? null : (usedAt.get(handle) ?? null),
    };
  }

  async function buildListings(): Promise<Result<readonly SecretListing[], SecretError>> {
    const byProvider = await entriesByProvider();
    if (!byProvider.ok) return byProvider;
    const metas = await deps.meta.list();
    const listings: SecretListing[] = [];
    const referenced = new Set<string>();
    for (const entry of metas) {
      if (entry.kind === "invalid") {
        // SecretListing에는 오류를 실을 필드가 없어 목록에서 뺀다. lease·resolve는 meta_invalid를 돌려준다
        deps.logger.warn("secrets.meta.invalid", { name: entry.error.name });
        continue;
      }
      referenced.add(`${entry.meta.provider}:${entry.meta.ref}`);
      listings.push(listingOf(entry.name, entry.meta, byProvider.value));
    }
    for (const [id, entries] of byProvider.value) {
      for (const entry of entries) {
        if (referenced.has(`${id}:${entry.ref}`)) continue;
        listings.push({ meta: null, entry, handle: null, status: "orphaned", lastUsedAt: null });
      }
    }
    return ok(listings);
  }

  // ── 서비스 ─────────────────────────────────────────────────────────────

  const service: SecretServiceRuntime = {
    redactor,

    async resolve(handle) {
      const loaded = await loadMeta(handle);
      if (!loaded.ok) return loaded;
      const byProvider = await entriesByProvider();
      if (!byProvider.ok) return byProvider;
      return ok(listingOf(loaded.value.name, loaded.value.meta, byProvider.value));
    },

    list: buildListings,

    async check(handle, ctx) {
      const loaded = await loadMeta(handle);
      if (!loaded.ok) return loaded;
      const { meta } = loaded.value;
      const outcome = decide(handle, meta, ctx);
      const decision: UseDecision =
        outcome.kind === "allow"
          ? { kind: "allow" }
          : outcome.kind === "deny"
            ? { kind: "deny", reason: outcome.reason }
            : {
                kind: "needs_approval",
                approval: outcome.approval,
                prompt: {
                  handle,
                  desc: meta.desc,
                  purpose: ctx.purpose,
                  target: ctx.target,
                  ttlSeconds: effectiveLimits(meta).ttlSeconds,
                },
              };
      return ok(decision);
    },

    async lease(handle, ctx) {
      const auth = await authorize(handle, ctx);
      if (!auth.ok) return auth;
      return openLease(auth.value, ctx);
    },

    withEnv(handle, ctx) {
      // target이 command가 아니면 정책 판정이 mode_not_allowed로 거부한다
      return service.lease(handle, { ...ctx, mode: "env" });
    },

    async withHttp<T extends HttpResponseLike>(
      template: HttpTemplate,
      ctx: Omit<UseCtx, "mode" | "target">,
      send: (req: ConcreteHttpRequest) => Promise<T>,
    ): Promise<Result<{ readonly response: T; readonly echoed: boolean }, SecretError>> {
      const plan = planHttp(template);
      if (!plan.ok) return plan;
      const target = {
        kind: "host",
        host: plan.value.url.hostname,
        port: targetPort(plan.value.url),
      } as const;
      const full: UseCtx = { ...ctx, mode: "runtime-http", target };

      // 1단계: 모든 핸들을 먼저 판정한다. 하나라도 거부면 아무 값도 풀지 않는다
      const checked = await Promise.all(plan.value.handles.map((h) => authorize(h, full)));
      const authorized: Authorized[] = [];
      for (const auth of checked) {
        if (!auth.ok) return auth;
        authorized.push(auth.value);
      }

      // 2단계: lease를 열고 값을 문자열로 꺼낸다(헤더·본문 치환에만 쓴다)
      const opened = await Promise.all(authorized.map((auth) => openLease(auth, full)));
      const leases: SecretLease[] = [];
      for (const result of opened) {
        if (result.ok) leases.push(result.value);
      }
      for (const result of opened) {
        if (!result.ok) {
          disposeAll(leases);
          return result;
        }
      }
      const extracted = await Promise.all(
        leases.map(async (lease) => ({
          handle: lease.handle,
          text: await lease.use((view) => view.text()),
        })),
      );
      const values = new Map<SecretHandle, string>();
      for (const { handle, text } of extracted) {
        if (!text.ok) {
          disposeAll(leases);
          return text;
        }
        values.set(handle, text.value);
      }

      const request: ConcreteHttpRequest = {
        method: template.method,
        url: template.url,
        headers: Object.fromEntries(
          Object.entries(template.headers).map(([key, value]) => [key, substitute(value, values)]),
        ),
        body: typeof template.body === "string" ? substitute(template.body, values) : template.body,
      };

      let response: T;
      try {
        response = await send(request);
      } finally {
        disposeAll(leases);
      }

      const texts = [response.bodyText ?? "", ...Object.values(response.headers)];
      const echoed = texts.some((text) => redactor.containsKnown(text));
      if (echoed) {
        const hits: RedactionHit[] = [];
        for (const text of texts) hits.push(...redactor.mask(text).hits);
        emit(maskedRecord({ hits, layer: "tool-result", threadId: ctx.threadId, at: clock.now() }));
      }
      return ok({ response, echoed });
    },

    withBrowserInput<T>(
      handle: SecretHandle,
      origin: string,
      ctx: Omit<UseCtx, "mode" | "target">,
      fill: (value: SecretValueView) => Promise<T>,
    ): Promise<Result<T, SecretError>> {
      // 사용 모드 browser-input은 마일스톤 M2다(SC-17). 그때까지는 모든 요청을 거부한다
      void origin;
      void fill;
      emit(
        deniedRecord({
          handle,
          mode: "browser-input",
          reason: "mode_not_allowed",
          ctx,
          at: clock.now(),
        }),
      );
      return Promise.resolve(err(deniedError(handle, "mode_not_allowed")));
    },

    protectedPaths: deps.protectedPaths,

    registerProvider(provider) {
      if (builtin.has(provider.id) || providers.has(provider.id)) {
        return err({ kind: "read_only_provider", provider: provider.id });
      }
      providers.set(provider.id, provider);
      return ok({
        [Symbol.dispose]() {
          if (providers.get(provider.id) === provider) providers.delete(provider.id);
        },
      });
    },

    onAudit: (sink) => bus.onAudit(sink),

    async diagnose() {
      const parts = await deps.diagnoseParts();
      const listed = await buildListings();
      const byProvider = await entriesByProvider();
      const listings = listed.ok ? listed.value : [];
      const rows = deps.configuredProviders().map((id) => {
        const registered = providers.has(id);
        const entries = byProvider.ok ? (byProvider.value.get(id) ?? null) : null;
        return providerRow(id, registered, registered && entries !== null ? entries.length : null);
      });
      return assembleDiagnostics({
        ...parts,
        providers: rows,
        missing: listings.filter((l) => l.status === "missing").length,
        orphaned: listings.filter((l) => l.status === "orphaned").length,
      });
    },

    revokeLeases(handle) {
      const live = activeLeases(handle);
      disposeAll(live);
      return live.length;
    },

    activeLeaseCount(handle) {
      return activeLeases(handle).length;
    },

    [Symbol.dispose]() {
      for (const set of active.values()) disposeAll([...set]);
    },
  };
  return service;
}
