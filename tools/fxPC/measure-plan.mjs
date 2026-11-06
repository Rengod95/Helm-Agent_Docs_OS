// 계획 승인 카드 레이아웃 실측(rtE R-1). 묶은 앱(CDP 9388)에서 계획 카드가 떠 있는 상태로 돌린다.
// 사용: node measure-plan.mjs [--send] [--shot 이름접두사]  — --send면 계획 요청을 보내고 카드를 기다린다(모델 호출 1회).
// 창 크기 1100x728, 1440x900마다: 계획 본문(code) 높이 > 0, 단추 3개 중심의 elementFromPoint가 그 단추, 카드 단추가 입력창과 겹치지 않음을 잰다. 하나라도 어긋나면 종료코드 1.
import { conn, shot } from "./h.mjs";
const args = process.argv.slice(2);
const { b, p } = await conn();
const cdp = await p.context().newCDPSession(p);
if (args.includes("--send")) {
  const ta = p.locator("textarea").last(); await ta.click();
  await ta.fill("enter_plan_mode로 계획 모드에 들어간 뒤, calc.ts를 sub·mul·div까지 갖춘 라이브러리로 키우는 계획을 20단계로(각 단계마다 2~3문장 설명, 번호 목록) 아주 길게 써서 exit_plan_mode로 제출해줘. 파일은 고치지 마.");
  await p.keyboard.press("Enter");
  await p.waitForSelector('[data-approval-kind="plan"]', { timeout: 120000 });
  await p.waitForTimeout(1500);
}
const prefix = args.includes("--shot") ? args[args.indexOf("--shot") + 1] : null;
let bad = 0;
for (const [w, h] of [[1100, 728], [1440, 900]]) {
  // Electron은 Browser.setWindowBounds가 없어 뷰포트를 에뮬레이션한다(레이아웃 폭·높이는 같다)
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await p.waitForTimeout(1000);
  const r = await p.evaluate(() => {
    const card = document.querySelector('[data-approval-kind="plan"]');
    if (!card) return { error: "no plan card" };
    const scroll = card.querySelector('[data-slot="approval-plan-scroll"]');
    const code = scroll?.querySelector("code, pre");
    const rect = (e) => { const q = e.getBoundingClientRect(); return [Math.round(q.x), Math.round(q.y), Math.round(q.width), Math.round(q.height)]; };
    const out = { win: [innerWidth, innerHeight], codeH: code ? Math.round(code.getBoundingClientRect().height) : null, scrollRect: scroll ? rect(scroll) : null, buttons: [] };
    const ta = [...document.querySelectorAll("textarea")].pop();
    out.composer = ta ? rect(ta.closest('[data-slot="textarea"]') ?? ta) : null;
    const bar = card.querySelector('[data-slot="approval-actions"]');
    for (const btn of bar?.querySelectorAll("button") ?? []) {
      const q = btn.getBoundingClientRect(); const top = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2);
      out.buttons.push({ name: btn.innerText.trim(), rect: rect(btn), ok: top === btn || btn.contains(top) || (btn.disabled && top !== null && !!btn.parentElement?.contains(top) && top.tagName !== "TEXTAREA"), disabled: btn.disabled, top: top ? top.tagName : null });
    }
    return out;
  });
  console.log(w + "x" + h, JSON.stringify(r));
  if (r.error || !(r.codeH > 20) || r.buttons.length < 3 || r.buttons.some((x) => !x.ok)) bad++;
  if (prefix) await shot(p, `${prefix}-${w}x${h}`);
}
await b.close();
process.exit(bad ? 1 : 0);
