import {
  attachFrame,
  createConfirmMemory,
  type BackendResult,
  type BridgeBackend,
  type BridgePolicyContext,
  type BridgePort,
  type ConfirmRequest,
} from "@fresnel/client/views/app";
import { detach, rethrow } from "@fresnel/contracts";
import { createScreenLedger } from "@fresnel/client/views/ledger";
import { SECRET_SENTINEL } from "./frame-app.ts";

// 시험용 셸 쪽 페이지. 운영과 같은 attachFrame과 다리 호스트를 쓰고, 백엔드만 기록용 대역이다. 프레임 주소는 질의 `frame`이다.
// 일을 마치면(`query report`) 지금까지 본 것을 `/report`로 알린다. 시험이 이 값을 비교한다.

const params = new URLSearchParams(location.search);
const frameUrl = params.get("frame") ?? "";

const outgoing: string[] = [];
const queries: unknown[] = [];
const pendingApprovals: { threadId: string; title: string }[] = [];
const grantedApprovals: string[] = [];
const executedCalls: string[] = [];
const confirmAsked: ConfirmRequest[] = [];
const unexpectedWindowMessages: unknown[] = [];

const ok = (value: unknown): BackendResult<unknown> => ({ ok: true, value });

const backend: BridgeBackend = {
  query(verb, queryParams) {
    if (verb === "report") {
      queries.push(queryParams);
      finish();
    }
    return Promise.resolve(ok(null));
  },
  events: () => Promise.resolve({ ok: true, value: [] }),
  settings: (keys) =>
    Promise.resolve({
      ok: true,
      value: keys.map((key) => ({
        key,
        secret: key === "ext.helm.apiKey",
        isSet: true,
        value: key === "ext.helm.apiKey" ? SECRET_SENTINEL : 3,
      })),
    }),
  host: () => ({
    threadId: "thr_1",
    threadTitle: "t",
    connection: "connected",
    locale: "ko",
    theme: "dark",
    extension: { enabled: true, trust: "user", safeMode: false },
  }),
  call(verb) {
    executedCalls.push(verb);
    return Promise.resolve(ok(null));
  },
  command: () => Promise.resolve(ok(null)),
  post: () => Promise.resolve(ok(null)),
  requestApproval(threadId, title) {
    // 표준 승인 카드는 셸이 그리고 사람이 답한다. 여기서는 대기 목록에만 넣고 결정하지 않는다
    pendingApprovals.push({ threadId, title });
    return Promise.resolve(ok({ outcome: "pending" }));
  },
  navigate: () => Promise.resolve(ok(null)),
  confirmExternal: () => Promise.resolve(false),
  resize: () => {},
  diagnostic: () => {},
};

const context: BridgePolicyContext = {
  extension: "helm",
  enabled: true,
  safeMode: false,
  methods: new Map([
    ["report", { readOnly: true, approval: false }],
    ["start", { readOnly: false, approval: false }],
  ]),
  readsRecordKinds: [],
  settingPrefixes: ["ext.helm."],
  ownCommands: new Set<string>(),
  allowPost: false,
  openThreadId: "thr_1",
};

const ledger = createScreenLedger();
const iframe = document.createElement("iframe");
document.body.append(iframe);

// 앱 문서로 오는 창 메시지는 `ready` 말고는 아무것도 효력이 없다. 어떤 것이 왔는지만 기록한다
window.addEventListener("message", (event) => {
  if (event.source === iframe.contentWindow) unexpectedWindowMessages.push(event.data);
});

attachFrame({
  element: iframe,
  messages: window,
  url: frameUrl,
  declaredBridge: "^1.0.0",
  createChannel: () => {
    const channel = new MessageChannel();
    let listener: ((event: MessageEvent) => void) | undefined;
    const tapped: BridgePort = {
      postMessage(message) {
        outgoing.push(JSON.stringify(message));
        channel.port1.postMessage(message);
      },
      setHandler(handler) {
        if (listener !== undefined) channel.port1.removeEventListener("message", listener);
        listener = handler === undefined ? undefined : (event) => handler(event.data);
        if (listener !== undefined) {
          channel.port1.addEventListener("message", listener);
          channel.port1.start();
        }
      },
      close() {
        channel.port1.close();
      },
    };
    return { port1: tapped, port2: channel.port2 };
  },
  scheduler: {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle),
  },
  ledger,
  screenKey: "helm/app",
  bridge: {
    context: () => context,
    backend,
    clock: { now: () => Date.now() },
    confirm: (request) => {
      // 사용자는 확인 줄에서 아무것도 누르지 않는다. 줄은 열렸고 응답은 거부다
      confirmAsked.push(request);
      return Promise.resolve("deny");
    },
    confirmMemory: createConfirmMemory(),
  },
  initialPushes: () => [{ name: "theme", value: { scheme: "dark" } }],
  onClosed: () => {},
});

function finish(): void {
  // 마지막 응답이 프레임에 닿을 시간을 한 틱 준다. 시간 값이 아니라 작업 순서를 기다린다
  setTimeout(() => {
    const body = JSON.stringify({
      queries,
      outgoing,
      pendingApprovals,
      grantedApprovals,
      executedCalls,
      confirmAsked,
      unexpectedWindowMessages,
      ledger: ledger.stateOf("helm/app"),
      hostUrl: location.href,
    });
    detach(fetch("/report", { method: "POST", body }), rethrow);
  }, 0);
}
