import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appFrameCsp, appResponseHeaders } from "@fresnel/client/views/app";
import { attempt, parse, parseJson } from "@fresnel/contracts";
import { Type, type Static } from "typebox";
import { FRAME_HTML, FRAME_JS, SECRET_SENTINEL } from "./frame-isolation/frame-app.ts";

// Y5(Linux e2e): 격리 프레임이 막혀야 하는 일을 실제 WebView에서 시도한다(ADR-0021 §3.6.2~§3.6.5).
// 셸 쪽은 운영 코드(attachFrame, 다리 호스트)를 그대로 쓴다. 프레임 파일은 전용 스킴 대신 http 서버가 같은 응답 헤더로 낸다.
// 이 시험이 보는 것: sandbox 속성과 CSP가 실제로 막는 것(저장소, 부모 DOM, eval, 팝업, 네트워크), 프레임 안 승인 버튼이 효력 없음,
// 다리 메시지에 시크릿 없음. 이 시험이 보지 못하는 것: Tauri가 전용 스킴 프레임에 IPC를 주입하지 않는지(`__TAURI__`는 여기서 애초에 없다).
// 그 부분은 macOS와 Linux 데스크톱 빌드의 실기 시험이다(ADR-0021 §6 미결 1). WebView를 띄울 수 없는 환경에서는 건너뛰고 이유를 남긴다.

const ReportSchema = Type.Object(
  {
    queries: Type.Array(Type.Unknown()),
    outgoing: Type.Array(Type.String()),
    pendingApprovals: Type.Array(Type.Object({ threadId: Type.String(), title: Type.String() })),
    grantedApprovals: Type.Array(Type.String()),
    executedCalls: Type.Array(Type.String()),
    confirmAsked: Type.Array(Type.Unknown()),
    unexpectedWindowMessages: Type.Array(Type.Unknown()),
    ledger: Type.Unknown(),
    hostUrl: Type.String(),
  },
  { additionalProperties: false },
);
const FrameReportSchema = Type.Object(
  {
    probes: Type.Record(Type.String(), Type.String()),
    networkResults: Type.Record(Type.String(), Type.String()),
    answers: Type.Record(Type.String(), Type.Unknown()),
    violations: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

/** `FRESNEL_E2E_WEBVIEW_BACKEND=chrome|webkit`. 비우면 Bun이 기기에 맞게 고른다(macOS는 WKWebView, Linux는 Chrome) */
const backendEnv = process.env["FRESNEL_E2E_WEBVIEW_BACKEND"];
const backendOption: { readonly backend?: "chrome" | "webkit" } =
  backendEnv === "chrome"
    ? { backend: "chrome" }
    : backendEnv === "webkit"
      ? { backend: "webkit" }
      : {};

const webViewAvailable = ((): boolean => {
  if (typeof Bun.WebView !== "function") return false;
  const probe = attempt(() => new Bun.WebView({ width: 100, height: 100, ...backendOption }));
  if (!probe.ok) return false;
  probe.value.close();
  return true;
})();
const e2e = webViewAvailable ? test : test.skip;

interface Run {
  readonly report: Static<typeof ReportSchema>;
  readonly frame: Static<typeof FrameReportSchema>;
  readonly canaryHits: readonly string[];
  readonly canaryOrigin: string;
  readonly frameFetches: readonly { path: string; csp: string | null; type: string | null }[];
}

let run: Run | undefined;
let resolveReport: (text: string) => void = () => {};
const servers: { stop(force?: boolean): unknown }[] = [];

async function bundleHostPage(): Promise<string> {
  const built = await Bun.build({
    entrypoints: [new URL("./frame-isolation/host-page.ts", import.meta.url).pathname],
    target: "browser",
    define: { __FRESNEL_CHECKS__: "true" },
  });
  if (!built.success)
    throw new Error(`host page bundle failed: ${built.logs.map(String).join("; ")}`);
  const output = built.outputs[0];
  if (output === undefined) throw new Error("host page bundle is empty");
  return output.text();
}

beforeAll(async () => {
  if (!webViewAvailable) return;
  const hostJs = await bundleHostPage();
  const canaryHits: string[] = [];
  const canary = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request, server) {
      canaryHits.push(new URL(request.url).pathname);
      if (server.upgrade(request)) return undefined;
      return new Response("hit", { headers: { "access-control-allow-origin": "*" } });
    },
    websocket: { message() {} },
  });
  servers.push(canary);
  const frameFetches: { path: string; csp: string | null; type: string | null }[] = [];
  const reported = new Promise<string>((resolve) => {
    resolveReport = resolve;
  });
  const shell = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/host.html") {
        return new Response(
          '<!doctype html><meta charset="utf-8"><body><script type="module" src="/host.js"></script>',
          {
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        );
      }
      if (url.pathname === "/host.js") {
        return new Response(hostJs, {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        });
      }
      if (url.pathname === "/report" && request.method === "POST") {
        resolveReport(await request.text());
        return new Response("ok");
      }
      // 전용 스킴의 대역: 접두 `/app/helm/1.0.0/`가 `fresnel-view://helm/1.0.0/`에 해당하고 응답 헤더는 같은 함수가 만든다
      const base = `http://${request.headers.get("host") ?? ""}/app/helm/1.0.0/`;
      if (url.pathname === "/app/helm/1.0.0/index.html") {
        return new Response(FRAME_HTML, {
          headers: appResponseHeaders("text/html; charset=utf-8", base) ?? {},
        });
      }
      if (url.pathname === "/app/helm/1.0.0/app.js") {
        return new Response(FRAME_JS, {
          headers: appResponseHeaders("text/javascript; charset=utf-8", base) ?? {},
        });
      }
      // 프레임이 앱 쪽 서버로 직접 붙으려는 시도(`fetch("/probe-self")`)도 여기 걸린다
      // Chrome은 문서마다 /favicon.ico를 따로 묻는다. 프레임이 아니라 브라우저가 하는 일이라 센 것에서 뺀다
      if (url.pathname !== "/favicon.ico")
        frameFetches.push({ path: url.pathname, csp: null, type: null });
      return new Response("nope", { status: 404 });
    },
  });
  servers.push(shell);
  const canaryOrigin = `http://127.0.0.1:${String(canary.port)}`;
  const frameUrl = `http://127.0.0.1:${String(shell.port)}/app/helm/1.0.0/index.html?canary=${encodeURIComponent(canaryOrigin)}`;
  const view = new Bun.WebView({ width: 800, height: 600, ...backendOption });
  try {
    await view.navigate(
      `http://127.0.0.1:${String(shell.port)}/host.html?frame=${encodeURIComponent(frameUrl)}`,
    );
    // 보고가 올 때까지 기다린다. 보고가 안 오면 시험 시간 제한이 끊는다
    const text = await reported;
    const json = parseJson(text);
    if (!json.ok) throw new Error("report is not JSON");
    const report = parse(ReportSchema, json.value);
    if (!report.ok) throw new Error(`report shape: ${JSON.stringify(report.error.issues)}`);
    const lastQuery: unknown = report.value.queries.at(-1);
    const frame = parse(FrameReportSchema, lastQuery);
    if (!frame.ok) throw new Error(`frame report shape: ${JSON.stringify(frame.error.issues)}`);
    run = { report: report.value, frame: frame.value, canaryHits, canaryOrigin, frameFetches };
  } finally {
    view.close();
  }
}, 60_000);

afterAll(() => {
  for (const server of servers) server.stop(true);
});

describe("Plugin App frame isolation (Y5, Linux e2e)", () => {
  e2e("the frame got no Tauri globals, no parent or storage access, no eval, no popup", () => {
    expect(run?.frame.probes).toEqual({
      tauri: "undefined/undefined/undefined",
      parentDom: "threw:SecurityError",
      topDom: "threw:SecurityError",
      localStorage: "threw:SecurityError",
      sessionStorage: "threw:SecurityError",
      cookie: "threw:SecurityError",
      eval: "threw:EvalError",
      open: "null",
      origin: "null",
      topNavigation: "threw:SecurityError",
    });
  });

  e2e(
    "every network route from the frame failed and nothing reached the canary or the shell server",
    () => {
      expect(run?.frame.networkResults).toEqual({
        fetchCanary: "rejected",
        fetchSelf: "rejected",
        xhr: "rejected",
        websocket: "rejected",
      });
      // 막혔다는 증거: 브라우저가 CSP 위반으로 알린 요청의 목적지 출처
      const canaryViolations = (run?.frame.violations ?? []).filter((line) =>
        line.endsWith(run?.canaryOrigin ?? "-"),
      );
      expect(canaryViolations.some((line) => line.startsWith("connect-src"))).toBe(true);
      expect(canaryViolations.some((line) => line.startsWith("img-src"))).toBe(true);
      expect(run?.canaryHits).toEqual([]);
      expect(run?.frameFetches).toEqual([]);
    },
  );

  e2e("the frame could not navigate the app document away", () => {
    expect(run?.report.hostUrl.startsWith("http://127.0.0.1:")).toBe(true);
    expect(run?.report.hostUrl).toContain("/host.html");
  });

  e2e("an approve button drawn inside the frame approves nothing", () => {
    // 창 메시지로 승인을 주장한 것은 앱 문서가 효력 없이 받았을 뿐이다
    expect(run?.report.grantedApprovals).toEqual([]);
    // 창 메시지와 포트 메시지는 서로 순서가 보장되지 않는다(Chrome은 프레임이 다른 프로세스다). 그래서 오는 것이 이 둘뿐임만 본다
    const stray = (run?.report.unexpectedWindowMessages ?? []).filter(
      (message) =>
        JSON.stringify(message) !== JSON.stringify({ v: 1, ready: true, bridge: "^1.0.0" }) &&
        JSON.stringify(message) !== JSON.stringify({ approve: true, id: "approval-1" }),
    );
    expect(stray).toEqual([]);
    // 다리로는 모르는 op가 막히고, requestApproval은 셸이 그리는 대기 카드가 될 뿐 결정은 사람 몫이다
    expect(run?.frame.answers["fakeOp"]).toMatchObject({
      v: 1,
      ok: false,
      error: { kind: "args_invalid", detail: "request" },
    });
    expect(run?.report.pendingApprovals).toEqual([
      { threadId: "thr_1", title: "Allow deleting everything?" },
    ]);
    expect(run?.frame.answers["requestApproval"]).toMatchObject({
      ok: true,
      value: { outcome: "pending" },
    });
  });

  e2e("a write call waits for the shell's confirmation line and was not run", () => {
    expect(run?.report.confirmAsked).toEqual([
      {
        extension: "helm",
        trust: "user",
        action: "start",
        paramsSummary: "",
        approval: false,
      },
    ]);
    expect(run?.report.executedCalls).toEqual([]);
    expect(run?.frame.answers["call"]).toMatchObject({
      ok: false,
      error: { kind: "denied", detail: "not_confirmed" },
    });
  });

  e2e("the bridge refuses reads and writes outside the declaration", () => {
    expect(run?.frame.answers["queryWrite"]).toMatchObject({
      ok: false,
      error: { kind: "denied", detail: "query_needs_read_only" },
    });
    expect(run?.frame.answers["foreignSetting"]).toMatchObject({
      ok: false,
      error: { kind: "not_declared", detail: "setting_key" },
    });
    expect(run?.frame.answers["foreignEvents"]).toMatchObject({
      ok: false,
      error: { kind: "not_declared", detail: "event_kind" },
    });
    expect(run?.frame.answers["externalMethod"]).toMatchObject({
      ok: false,
      error: { kind: "args_invalid" },
    });
  });

  e2e("bridge messages carry no secret value, only set or unset", () => {
    expect(run?.frame.answers["secrets"]).toMatchObject({
      ok: true,
      value: [
        { key: "ext.helm.apiKey", status: "set" },
        { key: "ext.helm.depth", value: 3 },
      ],
    });
    const everything = [...(run?.report.outgoing ?? []), JSON.stringify(run?.frame)].join("\n");
    expect(everything.includes(SECRET_SENTINEL)).toBe(false);
    expect(everything.includes("sk-live")).toBe(false);
  });

  e2e("the screen ledger saw only the one malformed message the frame sent on purpose", () => {
    expect(run?.report.ledger).toEqual({ state: "active", consecutive: 0 });
  });

  test("the frame document CSP closes the network and names only the extension prefix", () => {
    const csp = appFrameCsp("http://127.0.0.1:1/app/helm/1.0.0/");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src http://127.0.0.1:1/app/helm/1.0.0/;");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("'self'");
  });
});
