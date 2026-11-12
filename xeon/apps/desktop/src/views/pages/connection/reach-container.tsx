import { attemptAsync, detach, rethrow, type Result } from "@fresnel/contracts";
import { useEffect, useState } from "react";
import type {
  ProxyExample,
  RemoteAdapter,
  RemoteError,
  RemotePreflight,
  RemoteStatus,
  TailscaleInfo,
} from "../../../app/remote/remote-types.ts";
import { useCommands } from "../../commands.ts";
import { useOptionalPluginUi } from "../../plugin/plugin-context.tsx";
import {
  domainIssueOf,
  publicDomainOf,
  type DomainApply,
  type Fetch,
  type ProxyKind,
  type ReachSetupState,
} from "./reach-model.ts";

// "휴대폰·브라우저에서 쓰기" 구역의 새 호출(`useCommands().remote`의 preflight·tailscale·config·proxyExample)을 부르는 훅.
// 그림(`reach-section.tsx`)은 `ReachSetupState`와 동작만 받는다. 실패는 값(`Result`)이라 던지지 않는다.
// 사전 점검과 Tailscale 상태는 "읽은 열쇠"와 함께 둔다: 다른 기기 접속 상태(`statusKey`)가 바뀌거나 다시 읽기를 누르면 열쇠가 바뀌고,
// 그 열쇠의 답이 올 때까지 그림에는 "읽는 중"으로 보인다(이펙트 안에서 상태를 바로 바꾸지 않는다).

/** 그림이 부르는 동작 */
export interface ReachSetupActions {
  /** 사전 점검 다시 */
  readonly recheck: () => void;
  /** Tailscale 상태 다시 읽기 */
  readonly reloadTailscale: () => void;
  /** `tailscale serve` 켜기(확인은 그림이 받았다)·끄기 */
  readonly setServe: (on: boolean) => void;
  /** 공개 서버 도메인 적용: 프록시 예시의 루프백 전용 구성 → 검사(dryRun) → 쓰기 */
  readonly applyDomain: (domain: string) => void;
  /** 프록시 종류 고르기. 적용된 도메인이 있으면 예시를 다시 읽는다 */
  readonly setProxyKind: (kind: ProxyKind) => void;
  /** 적용된 도메인의 프록시 예시를 아직 안 읽었으면 읽는다 */
  readonly ensureProxy: () => void;
  /** 허용 주소에 이름을 더한다(사전 점검 autoFix) */
  readonly addAllowedHosts: (hosts: readonly string[]) => void;
  /** 바깥 링크(Tailscale 받기·로그인·동의 페이지)를 OS 브라우저로 연다. 열 수 없으면 복사한다 */
  readonly openLink: (url: string) => void;
}

/** 지금 쓰는 공개 도메인: 이번에 적용한 것, 아니면 허용 주소에 든 것 */
export function appliedDomainOf(
  setup: ReachSetupState,
  status: RemoteStatus | null,
): string | null {
  if (setup.domain.kind === "applied") return setup.domain.domain;
  return status === null ? null : publicDomainOf(status.hosts);
}

function run(work: Promise<void>): void {
  detach(work, rethrow);
}

/** 열쇠와 함께 둔 읽기 값 */
interface Keyed<T> {
  readonly key: string;
  readonly value: Fetch<T>;
}

function fetchOf<T>(result: Result<T, RemoteError>): Fetch<T> {
  return result.ok
    ? { kind: "ready", value: result.value }
    : { kind: "failed", error: result.error };
}

/** 열쇠가 지금 것과 같으면 값, 아니면 읽는 중. 꺼져 있으면 아직 부르지 않음 */
function shownOf<T>(stored: Keyed<T> | null, key: string, enabled: boolean): Fetch<T> {
  if (!enabled) return { kind: "idle" };
  return stored !== null && stored.key === key ? stored.value : { kind: "loading" };
}

export function useReachSetup(options: {
  readonly status: RemoteStatus | null;
  /** 다른 기기 접속이 켜져 있다. 꺼져 있으면 아무것도 읽지 않는다 */
  readonly enabled: boolean;
  /** 서비스·접속 상태가 바뀔 때 달라지는 값. 바뀌면 다시 읽는다 */
  readonly statusKey: string;
  readonly copy: (text: string) => void;
}): { readonly setup: ReachSetupState; readonly actions: ReachSetupActions } {
  const adapter: RemoteAdapter = useCommands().remote;
  const pluginUi = useOptionalPluginUi();
  const { status, enabled, statusKey, copy } = options;
  const [preflightRound, setPreflightRound] = useState(0);
  const [tailscaleRound, setTailscaleRound] = useState(0);
  const [preflight, setPreflight] = useState<Keyed<RemotePreflight> | null>(null);
  const [tailscale, setTailscale] = useState<Keyed<TailscaleInfo> | null>(null);
  const [serveBusy, setServeBusy] = useState(false);
  const [domain, setDomain] = useState<DomainApply>({ kind: "idle" });
  const [hosts, setHosts] = useState({ busy: false, restartNeeded: false });
  const [proxyKind, setProxyKindState] = useState<ProxyKind>("caddy");
  const [proxy, setProxy] = useState<Fetch<ProxyExample>>({ kind: "idle" });

  const preflightKey = `${statusKey}#${String(preflightRound)}`;
  const tailscaleKey = `${statusKey}#${String(tailscaleRound)}`;

  useEffect(() => {
    if (!enabled) return undefined;
    let stale = false;
    run(
      adapter.preflight().then((result) => {
        if (!stale) setPreflight({ key: preflightKey, value: fetchOf(result) });
        return undefined;
      }),
    );
    return () => {
      stale = true;
    };
  }, [adapter, enabled, preflightKey]);

  useEffect(() => {
    if (!enabled) return undefined;
    let stale = false;
    run(
      adapter.tailscale("status").then((result) => {
        if (!stale) setTailscale({ key: tailscaleKey, value: fetchOf(result) });
        return undefined;
      }),
    );
    return () => {
      stale = true;
    };
  }, [adapter, enabled, tailscaleKey]);

  const setup: ReachSetupState = {
    preflight: shownOf(preflight, preflightKey, enabled),
    tailscale: shownOf(tailscale, tailscaleKey, enabled),
    serveBusy,
    domain,
    hosts,
    proxyKind,
    proxy,
  };

  const recheck = (): void => {
    setPreflightRound((round) => round + 1);
  };
  const tlsPort = status?.tlsPort ?? null;
  const domainNow = appliedDomainOf(setup, status);

  const loadProxy = async (kind: ProxyKind, name: string): Promise<void> => {
    if (tlsPort === null) return;
    setProxy({ kind: "loading" });
    setProxy(fetchOf(await adapter.proxyExample({ kind, domain: name, tlsPort })));
  };

  const applyDomain = async (name: string): Promise<void> => {
    if (tlsPort === null || domainIssueOf(name) !== null) return;
    setDomain({ kind: "applying" });
    setProxy({ kind: "loading" });
    const example = await adapter.proxyExample({ kind: proxyKind, domain: name, tlsPort });
    if (!example.ok) {
      setDomain({ kind: "failed", error: example.error });
      setProxy({ kind: "idle" });
      return;
    }
    const plan = example.value.plan;
    const patch = { listen: plan.listen, listenTls: plan.listenTls, hosts: [...plan.hosts] };
    const checked = await adapter.config({ patch, dryRun: true });
    if (!checked.ok || checked.value.issues.length > 0) {
      setDomain(
        checked.ok
          ? { kind: "invalid", codes: checked.value.issues.map((issue) => issue.code) }
          : { kind: "failed", error: checked.error },
      );
      setProxy({ kind: "idle" });
      return;
    }
    const written = await adapter.config({ patch });
    if (!written.ok) {
      setDomain({ kind: "failed", error: written.error });
      setProxy({ kind: "idle" });
      return;
    }
    setDomain({ kind: "applied", domain: name, restartNeeded: written.value.restartNeeded });
    setProxy({ kind: "ready", value: example.value });
    recheck();
  };

  const setServe = async (on: boolean): Promise<void> => {
    setServeBusy(true);
    const result = await adapter.tailscale(on ? "serveOn" : "serveOff");
    setServeBusy(false);
    setTailscale({ key: tailscaleKey, value: fetchOf(result) });
    recheck();
  };

  const addAllowedHosts = async (names: readonly string[]): Promise<void> => {
    setHosts((prev) => ({ ...prev, busy: true }));
    const current = await adapter.config({});
    const before = current.ok ? current.value.settings.hosts : (status?.hosts ?? []);
    const merged = [...before, ...names.filter((name) => !before.includes(name))];
    const written = await adapter.config({ patch: { hosts: merged } });
    setHosts({ busy: false, restartNeeded: written.ok && written.value.restartNeeded });
    recheck();
  };

  const openExternal = pluginUi?.openExternal ?? null;
  const openLink = async (url: string): Promise<void> => {
    if (openExternal === null) {
      copy(url);
      return;
    }
    // 웹 셸처럼 셸 명령이 없으면 열기가 거절된다. 그때는 링크를 복사해 사용자가 직접 연다
    const opened = await attemptAsync(() => openExternal(url));
    if (!opened.ok) copy(url);
  };

  const actions: ReachSetupActions = {
    recheck,
    reloadTailscale: () => {
      setTailscaleRound((round) => round + 1);
    },
    setServe: (on) => {
      run(setServe(on));
    },
    applyDomain: (name) => {
      run(applyDomain(name.trim()));
    },
    setProxyKind: (kind) => {
      setProxyKindState(kind);
      if (domainNow !== null) run(loadProxy(kind, domainNow));
    },
    ensureProxy: () => {
      if (domainNow !== null && proxy.kind === "idle") run(loadProxy(proxyKind, domainNow));
    },
    addAllowedHosts: (names) => {
      run(addAllowedHosts(names));
    },
    openLink: (url) => {
      run(openLink(url));
    },
  };
  return { setup, actions };
}
