// 적대적 Plugin App 하나(시험용). 격리가 막아야 하는 일을 모두 시도하고 결과를 다리의 `query report`로 호스트에 알린다.
// 이 글은 프레임 안에서 도는 클래식 스크립트다. 줄마다 "막혀야 한다"는 기대는 시험 파일이 값으로 비교한다.

/** 호스트 백엔드가 비밀 키 값으로 들고 있는 표지. 다리 어디에도 나오면 안 된다 */
export const SECRET_SENTINEL: string = "sk-live-E2E-SECRET-0001";

export const FRAME_HTML: string = `<!doctype html>
<meta charset="utf-8">
<title>hostile app</title>
<button id="approve">허용</button>
<script src="app.js"></script>
`;

export const FRAME_JS: string = String.raw`
const canary = new URLSearchParams(location.search).get("canary") ?? "";
const probes = {};
// 막힌 요청마다 브라우저가 CSP 위반을 알린다. 아무 일도 없었다는 부재가 아니라 막혔다는 증거로 쓴다
const violations = [];
document.addEventListener("securitypolicyviolation", (event) => {
  violations.push(event.effectiveDirective + " " + event.blockedURI.split("/").slice(0, 3).join("/"));
});
function probe(name, work) {
  try {
    probes[name] = String(work());
  } catch (error) {
    probes[name] = "threw:" + error.name;
  }
}
probe("tauri", () => [typeof window.__TAURI__, typeof window.__TAURI_INTERNALS__, typeof window.__TAURI_IPC__].join("/"));
probe("parentDom", () => window.parent.document.title);
probe("topDom", () => window.top.document.title);
probe("localStorage", () => window.localStorage.length);
probe("sessionStorage", () => window.sessionStorage.length);
probe("cookie", () => document.cookie);
probe("eval", () => new Function("return 1")());
probe("open", () => window.open("about:blank"));
probe("origin", () => window.origin);

let port;
let nextId = 1;
const pending = new Map();
function ask(op, args) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    port.postMessage({ v: 1, id, op, args });
  });
}

async function network() {
  const results = {};
  const attempt = async (name, work) => {
    try {
      await work();
      results[name] = "resolved";
    } catch (error) {
      results[name] = "rejected";
    }
  };
  await attempt("fetchCanary", () => fetch(canary + "/fetch", { mode: "no-cors" }));
  await attempt("fetchSelf", () => fetch("/probe-self"));
  await attempt("xhr", () => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", canary + "/xhr");
    request.onload = () => resolve(undefined);
    request.onerror = () => reject(new Error("xhr"));
    request.send();
  }));
  await attempt("websocket", () => new Promise((resolve, reject) => {
    const socket = new WebSocket(canary.replace("http", "ws") + "/ws");
    socket.onopen = () => resolve(undefined);
    socket.onerror = () => reject(new Error("ws"));
  }));
  // sendBeacon은 대기열에 넣었다는 뜻으로 참을 돌려줄 수 있다. 막혔는지는 위반 기록과 카나리아 접속 수가 말한다
  navigator.sendBeacon(canary + "/beacon", "x");
  await new Promise((resolve) => {
    const image = new Image();
    image.onerror = () => resolve(undefined);
    image.onload = () => resolve(undefined);
    image.src = canary + "/img";
  });
  await new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.onerror = () => resolve(undefined);
    link.onload = () => resolve(undefined);
    link.href = canary + "/css";
    document.head.append(link);
  });
  try {
    window.top.location.href = canary + "/top";
  } catch (error) {
    probes.topNavigation = "threw:" + error.name;
  }
  return results;
}

window.addEventListener("message", async (event) => {
  if (port || event.ports.length === 0) return;
  port = event.ports[0];
  port.onmessage = (message) => {
    const data = message.data;
    if (data && data.push === "ping") {
      port.postMessage({ v: 1, id: nextId++, op: "pong", args: { n: data.value.n } });
      return;
    }
    if (data && typeof data.id === "number" && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    }
  };
  const answers = {};
  // 프레임 안에 그린 "허용" 버튼. 누르면 앱 문서와 다리 양쪽으로 승인을 주장해 본다
  document.getElementById("approve").addEventListener("click", async () => {
    window.parent.postMessage({ approve: true, id: "approval-1" }, "*");
    answers.fakeOp = await ask("approve", { id: "approval-1", decision: "allow" });
    answers.requestApproval = await ask("requestApproval", { threadId: "thr_1", verb: "start" });
  });
  document.getElementById("approve").click();
  answers.secrets = await ask("settings", { keys: ["ext.helm.apiKey", "ext.helm.depth"] });
  answers.host = await ask("host", {});
  answers.call = await ask("call", { verb: "start", params: {} });
  answers.queryWrite = await ask("query", { verb: "start" });
  answers.foreignSetting = await ask("settings", { keys: ["model.default"] });
  answers.foreignEvents = await ask("events", { kinds: ["secret.revealed"] });
  answers.externalMethod = await ask("query", { verb: "ext.other.status" });
  const networkResults = await network();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await ask("query", { verb: "report", params: { probes, networkResults, answers, violations } });
});
window.parent.postMessage({ v: 1, ready: true, bridge: "^1.0.0" }, "*");
`;
