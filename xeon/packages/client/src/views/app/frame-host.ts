import { BRIDGE_VERSION, BridgeReadySchema, type BridgePush } from "@fresnel/contracts/extensions";
import { parse, type Scheduler, type TimerHandle } from "@fresnel/contracts";
import type { LedgerFailure, ScreenLedger } from "../ledger.ts";
import {
  createBridgeHost,
  type BridgeHost,
  type BridgeHostOptions,
  type BridgePort,
} from "./bridge-host.ts";

// Plugin App 프레임 호스트(V-29, ADR-0021 §3.4.2, §3.6.2). iframe 하나의 수명: 속성 걸기, `ready` 기다리기, 포트 한 번 넘기기,
// 다리 만들기, 다시 불러옴 감지, 내리기. DOM 타입을 직접 쓰지 않고 구조로만 받아 시험이 대역을 넣는다.

/** `<iframe sandbox="allow-scripts">`. 다른 토큰은 주지 않는다(§3.6.2 1항). 이 값이 곧 격리의 한 축이라 시험이 글자를 고정한다 */
export const FRAME_SANDBOX = "allow-scripts" as const;
export const READY_TIMEOUT_MS = 5000;
export const HOST_BRIDGE_RANGE: string = `${String(BRIDGE_VERSION)}.0.0`;

export interface FrameWindowLike {
  postMessage(message: unknown, targetOrigin: string, transfer: readonly unknown[]): void;
}
export interface FrameElementLike {
  setAttribute(name: string, value: string): void;
  readonly contentWindow: FrameWindowLike | null;
  addEventListener(type: "load", listener: () => void): void;
  removeEventListener(type: "load", listener: () => void): void;
}
export interface MessageEventLike {
  readonly source: unknown;
  readonly data: unknown;
}
export interface MessageSourceLike {
  addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
}
export interface ChannelLike {
  readonly port1: BridgePort;
  /** 프레임으로 옮겨 보내는 쪽 */
  readonly port2: unknown;
}

export type FrameState = "loading" | "ready" | "closed";

export interface FrameHostOptions {
  readonly element: FrameElementLike;
  /** 앱 문서의 `window`. `message`를 듣는다 */
  readonly messages: MessageSourceLike;
  /** `fresnel-view://...` 프레임 주소. buildAppUrl이 만든 값 */
  readonly url: string;
  /** 매니페스트 `app.bridge`. `ready`가 같은 값을 말해야 한다 */
  readonly declaredBridge: string;
  readonly createChannel: () => ChannelLike;
  readonly scheduler: Scheduler;
  readonly ledger: ScreenLedger;
  readonly screenKey: string;
  /** 다리 호스트에 넘기는 옵션. `port`는 호스트가 정한다 */
  readonly bridge: Omit<
    BridgeHostOptions,
    "port" | "onClosed" | "ledger" | "scheduler" | "screenKey"
  >;
  /** 포트를 넘긴 직후 처음 보낼 푸시(테마, host) */
  readonly initialPushes: () => readonly { readonly name: BridgePush; readonly value: unknown }[];
  readonly onClosed: (reason: LedgerFailure | "disposed") => void;
}

export interface FrameHost {
  readonly state: FrameState;
  readonly bridge: BridgeHost | undefined;
  push(name: BridgePush, value: unknown): void;
  dispose(): void;
}

/** iframe에 거는 속성. `src`는 마지막에 건다(다른 속성이 먼저 적용돼야 한다) */
export function applyFrameAttributes(element: FrameElementLike, url: string): void {
  element.setAttribute("sandbox", FRAME_SANDBOX);
  element.setAttribute("referrerpolicy", "no-referrer");
  // 권한 정책을 비운다(카메라, 마이크, 위치 등 전부 막힘)
  element.setAttribute("allow", "");
  element.setAttribute("src", url);
}

export function attachFrame(options: FrameHostOptions): FrameHost {
  const { element, messages, scheduler } = options;
  let state: FrameState = "loading";
  let bridge: BridgeHost | undefined;
  let readyTimer: TimerHandle | undefined;
  let loads = 0;

  function close(reason: LedgerFailure | "disposed"): void {
    if (state === "closed") return;
    state = "closed";
    if (readyTimer !== undefined) scheduler.clearTimeout(readyTimer);
    readyTimer = undefined;
    messages.removeEventListener("message", onMessage);
    element.removeEventListener("load", onLoad);
    bridge?.dispose();
    options.onClosed(reason);
  }
  function fail(failure: LedgerFailure): void {
    options.ledger.fail(options.screenKey, failure);
    close(failure);
  }

  function onMessage(event: MessageEventLike): void {
    // 이 프레임의 창에서 온 것만 본다. 다른 창(앱 자신, 다른 프레임)은 계수 없이 버린다
    const target = element.contentWindow;
    if (target === null || event.source !== target) return;
    // 포트를 넘긴 뒤에는 창 메시지를 받지 않는다. 이후 대화는 포트로만 한다(§3.4.2)
    if (state !== "loading") return;
    const ready = parse(BridgeReadySchema, event.data);
    if (!ready.ok || ready.value.bridge !== options.declaredBridge) {
      fail("bridge_format");
      return;
    }
    if (readyTimer !== undefined) scheduler.clearTimeout(readyTimer);
    readyTimer = undefined;
    const channel = options.createChannel();
    state = "ready";
    bridge = createBridgeHost({
      ...options.bridge,
      port: channel.port1,
      ledger: options.ledger,
      scheduler,
      screenKey: options.screenKey,
      onClosed: (reason) => close(reason),
    });
    // 프레임 origin은 불투명이라 대상 origin을 지정할 수 없다. 위에서 source 창을 확인한 뒤 한 번만 넘긴다
    target.postMessage({ v: BRIDGE_VERSION, ready: true, bridge: HOST_BRIDGE_RANGE }, "*", [
      channel.port2,
    ]);
    for (const first of options.initialPushes()) bridge.push(first.name, first.value);
    bridge.startLiveness();
  }

  function onLoad(): void {
    loads += 1;
    // 처음 불러옴은 정상이다. 두 번째부터는 프레임이 스스로 다른 문서로 옮겨 간 것이라 포트를 거둔다(옮겨 간 문서가 포트를 쥐지 못하게)
    if (loads > 1) fail("frame_navigated");
  }

  messages.addEventListener("message", onMessage);
  element.addEventListener("load", onLoad);
  applyFrameAttributes(element, options.url);
  readyTimer = scheduler.setTimeout(() => fail("ready_timeout"), READY_TIMEOUT_MS);

  return {
    get state() {
      return state;
    },
    get bridge() {
      return bridge;
    },
    push(name, value) {
      bridge?.push(name, value);
    },
    dispose() {
      close("disposed");
    },
  };
}
