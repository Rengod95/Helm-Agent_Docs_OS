import { conn, body, shot } from "./h.mjs";
const { b, p } = await conn();
await p.getByRole("button", { name: "새 대화" }).first().click();
await p.waitForTimeout(1500);
console.log(await body(p, 800));
const btn = p.getByRole("button", { name: /폴더 없이/ });
console.log("nofolder btn", await btn.count());
if (await btn.count()) { await btn.first().click(); await p.waitForTimeout(1500); }
console.log(await body(p, 800));
await b.close();
