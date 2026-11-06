// main.ts와 preload를 dist/bundle/에 번들한다. electron은 외부로 둔다.
// electron-updater는 번들에 넣는다(scripts/package.ts가 node_modules를 앱에서 뺀다). 동적 import라 설정이 없으면 적재되지 않는다.
const EXTERNAL: string[] = ["electron"];
const main: Bun.BuildOutput = await Bun.build({
  entrypoints: ["src/main.ts"],
  outdir: "dist/bundle",
  target: "node",
  format: "esm",
  external: EXTERNAL,
  naming: "main.mjs",
});
const preload: Bun.BuildOutput = await Bun.build({
  entrypoints: ["src/preload.ts"],
  outdir: "dist/bundle",
  target: "node",
  format: "cjs",
  external: EXTERNAL,
  naming: "preload.cjs",
});
for (const result of [main, preload]) {
  for (const log of result.logs) process.stderr.write(`${log.message}\n`);
}
if (!main.success || !preload.success) process.exit(1);

export {};
