import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseJson } from "@fresnel/contracts";
import { startStack, UI_DIR, type Gateway, type Stack } from "./stack.ts";
import { Tab } from "./tab.ts";
import { killStragglers } from "./stragglers.ts";

// 브라우저 E2E(L4.remote.spec §12 수용 기준 3·4·5와 §5.3·§6.3·§7·§11): 실제 서비스(임시 FRESNEL_HOME, 모델만 테이프) + 웹 게이트웨이(루프백 HTTP)
// + 헤드리스 Chrome 탭 둘. 오래 걸려서 `just verify` 밖이고 `just web-e2e`로 돈다. 띄운 서비스·게이트웨이·브라우저는 afterAll이 모두 끈다.
//
// 시험 이름 ↔ 스펙 §12:
//   "criterion 3 ..."  수용 기준 3(같은 UI 번들이 브라우저에서 대화 만들기, 입력, 승인 동작)
//   "criterion 4 ..."  수용 기준 4(탭 둘 동기화: 입력과 승인)
//   "criterion 5 ..."  수용 기준 5 중 기기 폐기가 열린 연결을 닫는다(코드 한 번 사용·만료는 pairing.test.ts, auth-port.test.ts)
//   "§11 ..." / "§6.3 ..."  실패 사례(게이트웨이 재시작 뒤 재연결)와 플러그인 프레임
// 시험은 위에서 아래로 한 묶음의 상태를 이어 쓴다(대화 → 입력 → 승인 → 재시작 → 폐기).

setDefaultTimeout(180_000);

// 사이드바에서 이 대화의 행: 제목은 첫 입력 글("hello tape")이거나 엔진이 붙인 제목(테이프의 두 번째 답 "web e2e")이다
const THREAD_ROW = `[...document.querySelectorAll('button[data-slot="list-navigation-link"]')].find((el) => ['hello tape', 'web e2e'].includes(el.innerText.trim()))`;
const UNREACHABLE = "서버에 닿지 않아요";
const REPLY = "tape-reply: hello from the fake model";
const FINAL = "tape-final: the command finished";
/** 테이프 키의 더미 값. 웹 첫 실행 화면으로 넣고, 사이드카가 임시 홈에 쓴다(실제 키가 아니다) */
const TAPE_KEY_DUMMY = "not-a-real-key";

/**
 * 첫 실행 화면에서 테이프 키를 넣고 제공자에 잇는다. 제공자 칸의 기본값은 anthropic이라 먼저 tape로 바꾼다.
 * 사이드카가 임시 홈에 시크릿을 쓰고, 저장이 되면 화면이 "제공자에 연결했어요."를 보인다
 */
async function enterTapeKey(tab: Tab): Promise<void> {
  await tab.fill("제공자", "tape");
  await tab.clickText("키 등록");
  await tab.fill("키 값", TAPE_KEY_DUMMY);
  await tab.clickText("저장");
  await tab.waitForText("제공자에 연결했어요.");
}

/** 값이 객체면 그 항목 표, 아니면 빈 표 */
function mapOf(value: unknown): ReadonlyMap<string, unknown> {
  return typeof value === "object" && value !== null ? new Map(Object.entries(value)) : new Map();
}

/** JSON 글을 값으로. 읽을 수 없으면 null */
function jsonOf(text: string): unknown {
  const parsed = parseJson(text);
  return parsed.ok ? parsed.value : null;
}

let stack: Stack | null = null;
let gateway: Gateway;
const tabs: Tab[] = [];

function openTab(name: string): Tab {
  const tab = new Tab(name);
  tabs.push(tab);
  return tab;
}

beforeAll(async () => {
  const started = await startStack();
  stack = started;
  gateway = await started.startGateway();
});

afterAll(async () => {
  for (const tab of tabs) tab.close();
  await stack?.dispose();
  const left = killStragglers();
  expect(left).toEqual([]);
});

let tabA: Tab;
let tabB: Tab;

describe("browser E2E", () => {
  test("criterion 3: pairing, login, and the same UI bundle loads", async () => {
    tabA = openTab("A");
    tabB = openTab("B");
    const loginA = await tabA.login(gateway, "tab-a");
    await tabB.login(gateway, "tab-b");
    expect(loginA.firstScreenMs).toBeGreaterThan(0);
    // 번들은 바이트 동일: 게이트웨이가 낸 index.html이 디스크의 UI 번들과 같다
    // (게이트웨이는 <head> 맨 앞에 웹 셸 shim 스크립트 태그 하나만 더한다)
    const served = await tabA.eval(
      `fetch('/', { credentials: 'same-origin' }).then((r) => r.text())`,
    );
    expect(served.replace('<script src="/shell/shim.js"></script>', "")).toBe(
      readFileSync(join(UI_DIR, "index.html"), "utf8"),
    );
    const assets = readdirSync(join(UI_DIR, "assets"));
    // (evaluate는 한 번에 하나만 걸 수 있어 페이지 안에서 한꺼번에 받는다)
    const sizes = await tabA.eval(
      `Promise.all(${JSON.stringify(assets)}.map((file) => fetch('/assets/' + file).then((r) => r.arrayBuffer()).then((b) => b.byteLength))).then((all) => all.join(','))`,
    );
    expect(sizes.split(",").map(Number)).toEqual(
      assets.map((file) => statSync(join(UI_DIR, "assets", file)).size),
    );
    const session = await tabA.eval(`fetch('/api/session').then((r) => r.status)`);
    expect(session).toBe("200");
    expect(await gateway.deviceIds()).toHaveLength(2);
    // 키는 웹의 첫 실행 화면에서 넣는다(데스크톱과 같은 사이드카 길). 메타 파일이 생긴 뒤 테이프 호출 허용을 더하고, 두 탭을 다시 읽는다
    await enterTapeKey(tabA);
    await tabA.reload();
    await tabB.reload();
  });

  test("criterion 3 and 4: a conversation made in tab A shows up in tab B", async () => {
    await tabA.clickText("새 대화");
    await tabA.waitForText("서버 폴더 고르기");
    await tabA.clickText("이 폴더 고르기");
    await tabA.waitFor(
      "composer",
      "document.querySelector('textarea[aria-label=\"메시지\"]:not([disabled])')",
    );
    // 목록 동기화: 탭 B의 사이드바에 같은 대화가 생긴다(대화 수 배지 1)
    await tabB.waitFor(
      "thread row in tab B",
      "[...document.querySelectorAll('button')].some((b) => b.innerText.trim().startsWith('대화') && b.innerText.includes('1'))",
    );
  });

  test("criterion 4: a message sent in tab A and the model reply show in tab B", async () => {
    await tabA.fill("메시지", "hello tape");
    await tabA.clickText("보내기");
    await tabA.waitForText(REPLY);
    // 탭 B는 대화를 열어 본문을 본다
    await tabB.clickFound("thread row", THREAD_ROW);
    await tabB.waitForText("hello tape");
    await tabB.waitForText(REPLY);
  });

  test("criterion 4: an approval asked in tab A is answered in tab B and clears in tab A", async () => {
    await tabA.fill("메시지", "run the command");
    await tabA.clickText("보내기");
    await tabA.waitForText('도구 "bash" 실행을 허용할까요?');
    // 탭 B도 같은 대화를 열어 두었으므로 같은 승인 요청이 보인다
    await tabB.waitForText('도구 "bash" 실행을 허용할까요?');
    await tabB.clickText("허용");
    // 첫 응답이 이기고 탭 A의 대기 표시가 사라지고 turn이 이어진다
    await tabA.waitForTextGone('도구 "bash" 실행을 허용할까요?');
    await tabA.waitForText(FINAL);
    await tabB.waitForText(FINAL);
  });

  test("§6.3: the viewdemo plugin frame opens in the browser", async () => {
    await tabA.clickText("플러그인 화면");
    await tabA.waitForText("Frame demo", 60_000);
    await tabA.clickText("Frame demo");
    await tabA.waitFor(
      "the plugin frame element",
      "document.querySelector('iframe[src*=\"/view/\"]')",
      60_000,
    );
    // 프레임은 쿠키 없이 경로의 권한 토큰으로 열리고(§6.3) sandbox에 allow-same-origin이 없다
    const frame = await tabA.eval(
      `(() => { const f = document.querySelector('iframe[src*="/view/"]'); return JSON.stringify({ src: f.getAttribute('src'), sandbox: f.getAttribute('sandbox') }); })()`,
    );
    const parsedFrame = mapOf(jsonOf(frame));
    const src = String(parsedFrame.get("src"));
    const sandbox = parsedFrame.get("sandbox");
    expect(src).toMatch(/\/view\/[A-Za-z0-9_-]{43}\/viewdemo\/1\.0\.0\/index\.html#n=[0-9a-f]+$/u);
    expect(sandbox).toBe("allow-scripts");
    // 준비 신호 악수가 끝나면 "불러오는 중…"이 사라지고 닫힘 안내는 없다
    await tabA.waitForTextGone("불러오는 중", 30_000);
    expect(await tabA.text()).not.toContain("닫혔어요");
    const served = await tabA.eval(
      `fetch(${JSON.stringify(src.split("#")[0])}, { credentials: 'omit' }).then((r) => r.status + ' ' + (r.headers.get('content-security-policy') ?? '').slice(0, 40))`,
    );
    expect(served).toMatch(/^200 /u);
  });

  test("§5.3: the TLS listener serves the login page with a self-signed certificate that matches the pinned fingerprint", async () => {
    const tlsPort = gateway.ready.tlsPort;
    if (tlsPort === null) throw new Error("the gateway opened no TLS listener");
    const response = await fetch(`https://127.0.0.1:${String(tlsPort)}/login`, {
      tls: { rejectUnauthorized: false },
    });
    expect(response.status).toBe(200);
    expect(gateway.ready.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("§11: after the gateway restarts, both tabs reconnect without a reload", async () => {
    const ports = { loopback: gateway.ready.loopbackPort, tls: gateway.ready.tlsPort ?? 0 };
    await gateway.stop();
    // 게이트웨이가 없는 동안 두 탭은 "서버에 닿지 않아요" 안내를 보이고(백오프 재시도), 새 게이트웨이가 서면 안내가 사라진다
    await tabA.waitForText(UNREACHABLE, 20_000);
    await tabB.waitForText(UNREACHABLE, 20_000);
    if (stack === null) throw new Error("the stack is not running");
    gateway = await stack.startGateway(ports);
    await tabA.waitForTextGone(UNREACHABLE, 60_000);
    await tabB.waitForTextGone(UNREACHABLE, 60_000);
    // 다시 붙은 연결로 새 대화를 만들면(모델 없이) 다른 탭의 대화 수가 2가 된다
    // (대화가 이미 있으면 새 대화 단추는 마지막으로 쓴 서버 폴더에 바로 만든다. 이름이 "새 대화 · <폴더>"다)
    await tabA.clickFound(
      "new thread button",
      `[...document.querySelectorAll('button')].find((el) => (el.getAttribute('aria-label') ?? '').startsWith('새 대화'))`,
    );
    await tabB.waitFor(
      "two threads in tab B",
      "[...document.querySelectorAll('button[data-slot=\"list-navigation-link\"]')].some((el) => el.innerText.trim().startsWith('대화') && el.innerText.includes('2'))",
      60_000,
    );
  });

  test("criterion 5: revoking a device closes its tab and sends it back to the login page", async () => {
    const session = mapOf(jsonOf(await tabB.eval(`fetch('/api/session').then((r) => r.text())`)));
    const deviceId: unknown = mapOf(session.get("device")).get("id");
    if (typeof deviceId !== "string") throw new Error("the session has no device id");
    await gateway.revoke(deviceId);
    // 폐기한 기기의 열린 연결은 닫히고, 쿠키로 다시 들어가면 로그인 화면이다
    await tabB.reload();
    await tabB.waitFor("login page", "location.pathname === '/login'");
    expect(await tabB.eval(`fetch('/api/session').then((r) => r.status)`)).toBe("401");
  });
});
