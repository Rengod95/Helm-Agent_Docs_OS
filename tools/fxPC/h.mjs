import { chromium } from "/Users/user/fresnel-tracks/_notes/tools/lib.mjs";
export const SH = process.env.HOME + "/fresnel-tracks/_notes/scenarios/rtE/shots";
export async function conn(port = 9388) {
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const p = b.contexts()[0].pages().find((x) => !x.url().startsWith("devtools")) ?? b.contexts()[0].pages()[0];
  return { b, p };
}
export const shot = (p, n) => p.screenshot({ path: `${SH}/${n}.png` });
export const body = async (p, n = 1500) => (await p.locator("body").innerText()).replace(/\n/g, " | ").slice(0, n);
