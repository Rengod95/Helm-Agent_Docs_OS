// main.ts와 preload를 out/에 번들한다. electron은 외부로 둔다.
const EXTERNAL: string[] = ["electron"];
const main: Bun.BuildOutput = await Bun.build({
  entrypoints: ["src/main.ts"],
  outdir: "out",
  target: "node",
  format: "esm",
  external: EXTERNAL,
  naming: "main.mjs",
});
const preload: Bun.BuildOutput = await Bun.build({
  entrypoints: ["src/preload.ts"],
  outdir: "out",
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
