import type { Gateway } from "./stack.ts";

// 브라우저 탭 하나(Bun.WebView, Chrome 백엔드, 헤드리스). 시험은 finally에서 `close()`를 부른다.
// 값 읽기와 클릭은 페이지 안 스크립트(`evaluate`)로 한다. 입력 칸은 React가 알아채게 값 대입 뒤 `input` 이벤트를 낸다.

const WAIT_MS = 30_000;
const POLL_MS = 100;

export class Tab {
  private readonly view: Bun.WebView;
  readonly name: string;
  constructor(name: string) {
    this.name = name;
    this.view = new Bun.WebView({ width: 1280, height: 900, backend: "chrome" });
  }

  get url(): string {
    return this.view.url;
  }

  navigate(url: string): Promise<void> {
    return this.view.navigate(url);
  }

  reload(): Promise<void> {
    return this.view.reload();
  }

  /** 페이지 안에서 식을 돌려 문자열로 받는다 */
  async eval(expression: string): Promise<string> {
    return String(await this.view.evaluate(expression));
  }

  text(): Promise<string> {
    return this.eval("document.body.innerText");
  }

  /** 조건(페이지 안 식이 참 값)이 될 때까지 기다린다. 마감이 있다. 실패 때 화면 글을 오류에 싣는다 */
  async waitFor(label: string, expression: string, timeoutMs: number = WAIT_MS): Promise<number> {
    const started = performance.now();
    const deadline = started + timeoutMs;
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- 마감이 있는 폴링이라 한 번에 하나씩 차례로 한다 (L4.remote.spec §12)
      const value = await this.eval(
        `(() => { try { return Boolean(${expression}); } catch { return false; } })()`,
      );
      if (value === "true") return performance.now() - started;
      if (performance.now() > deadline) {
        // oxlint-disable-next-line no-await-in-loop -- 마감이 있는 폴링이라 한 번에 하나씩 차례로 한다 (L4.remote.spec §12)
        const body = await this.text().catch(() => "(no text)");
        throw new Error(
          `[${this.name}] timed out waiting for ${label}. url=${this.url}\n${body.slice(0, 3000)}`,
        );
      }
      // oxlint-disable-next-line no-await-in-loop -- 마감이 있는 폴링이라 한 번에 하나씩 차례로 한다 (L4.remote.spec §12)
      await Bun.sleep(POLL_MS);
    }
  }

  /** 화면 글에 문구가 나타날 때까지 */
  waitForText(needle: string, timeoutMs?: number): Promise<number> {
    return this.waitFor(
      `text ${JSON.stringify(needle)}`,
      `document.body.innerText.includes(${JSON.stringify(needle)})`,
      timeoutMs,
    );
  }

  /** 화면 글에서 문구가 사라질 때까지 */
  waitForTextGone(needle: string, timeoutMs?: number): Promise<number> {
    return this.waitFor(
      `text gone ${JSON.stringify(needle)}`,
      `!document.body.innerText.includes(${JSON.stringify(needle)})`,
      timeoutMs,
    );
  }

  /** 보이는 글이 정확히 같은 단추·목록 항목을 누른다. 기다렸다가 누른다 */
  async clickText(label: string, timeoutMs?: number): Promise<void> {
    const find = `[...document.querySelectorAll('button,[role=button],[role=option],[role=tab],[role=radio],a')].find((el) => el.innerText.trim() === ${JSON.stringify(label)} || el.getAttribute('aria-label') === ${JSON.stringify(label)})`;
    await this.waitFor(`button ${JSON.stringify(label)}`, find, timeoutMs);
    await this.eval(`(() => { ${find}.click(); return true; })()`);
  }

  /** CSS 선택자에 맞는 첫 요소를 누른다. 기다렸다가 누른다 */
  async clickSelector(selector: string, timeoutMs?: number): Promise<void> {
    await this.waitFor(
      `element ${selector}`,
      `document.querySelector(${JSON.stringify(selector)})`,
      timeoutMs,
    );
    // 실제 마우스 입력(CDP)으로 누른다: 요소의 `click()`은 포인터 이벤트를 쓰는 목록 항목에 먹지 않는다
    await this.view.click(selector);
  }

  /** 페이지 안 식이 고른 요소(없으면 null)를 실제 마우스 입력으로 누른다. 기다렸다가 누른다 */
  async clickFound(label: string, finder: string, timeoutMs?: number): Promise<void> {
    await this.waitFor(label, `(${finder})`, timeoutMs);
    await this.eval(
      `(() => { document.querySelectorAll('[data-e2e-target]').forEach((e) => e.removeAttribute('data-e2e-target')); (${finder}).setAttribute('data-e2e-target', '1'); return true; })()`,
    );
    await this.view.click("[data-e2e-target]");
  }

  /** `aria-label`이 같은 입력 칸(textarea 또는 input)에 값을 넣는다 */
  async fill(ariaLabel: string, value: string): Promise<void> {
    const selector = `textarea[aria-label=${JSON.stringify(ariaLabel)}],input[aria-label=${JSON.stringify(ariaLabel)}]`;
    await this.waitFor(`field ${ariaLabel}`, `document.querySelector(${JSON.stringify(selector)})`);
    await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  }

  /** 로그인 화면에서 페어링 코드를 넣고 UI가 뜰 때까지(사이드바의 "새 대화") 기다린다. 걸린 시간(ms)을 돌려준다 */
  async login(gateway: Gateway, deviceName: string): Promise<{ readonly firstScreenMs: number }> {
    const code = await gateway.pairingCode();
    await this.navigate(`${gateway.origin}/login`);
    await this.waitFor("login form", "document.getElementById('pair-form')");
    const started = performance.now();
    await this.eval(`(() => {
      document.getElementById('code').value = ${JSON.stringify(code)};
      document.getElementById('device-name').value = ${JSON.stringify(deviceName)};
      document.getElementById('pair-form').requestSubmit();
      return true;
    })()`);
    await this.waitFor(
      "the UI first screen",
      "document.body.innerText.includes('새 대화') && document.body.innerText.includes('연결됨')",
    );
    return { firstScreenMs: performance.now() - started };
  }

  close(): void {
    this.view.close();
  }
}
