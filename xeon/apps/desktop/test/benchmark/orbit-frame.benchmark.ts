// Y17 (T-PERF). 크래프트 지도(Orbit)가 확장 77개 고정 데이터(buildFixture(77))에서 한 장을 그리려고 쓰는 계산 시간을 잰다.
// 재는 것은 CPU 쪽(배치 layoutOrbit, 밝힘 litOf, 지도에 보일 것 shownOnMap)뿐이다. WebGL 배경과 DOM 그리기, 화면 합성은 창이 있어야 해서 여기서 재지 않는다.
// 그래서 값은 "한 프레임 예산(16.7 ms) 중 계산이 먹는 몫"의 하한이지 실제 프레임 시간이 아니다.
// 실행(xeon/에서): bash scripts/guard.sh run -- bun apps/desktop/test/benchmark/orbit-frame.benchmark.ts [--frames <n>]
// 출력: stdout에 JSON 한 줄씩(metric, unit, value, note). 판정은 하지 않는다.
import { buildFixture } from "@fresnel/client/workbench/canvas";
import { litOf, shownOnMap } from "../../src/views/craft/orbit-model.ts";
import { layoutOrbit } from "../../src/views/craft/orbit-layout.ts";

const at = process.argv.indexOf("--frames");
const parsed = at < 0 ? 2000 : Number(process.argv[at + 1]);
const FRAMES = Number.isInteger(parsed) && parsed > 0 ? parsed : 2000;
const WARMUP = 200;

const snapshot = buildFixture(77);
const firstPlugin = snapshot.plugins[0];
if (firstPlugin === undefined) throw new Error("benchmark: the 77-extension fixture is empty");

function oneFrame(): number {
  const began = performance.now();
  const layout = layoutOrbit(snapshot);
  const lit = litOf({ k: "plugin", id: firstPlugin?.id ?? "" }, snapshot, {});
  const shown = shownOnMap(snapshot, []);
  const ended = performance.now();
  // 결과를 쓴 척 하지 않고 모양만 확인한다: 77개가 모두 배치되어야 같은 일을 잰 것이다
  if (layout.dots.length !== 77 || shown.length === 0 || !lit.active) {
    throw new Error("benchmark: the frame computed an unexpected result");
  }
  return ended - began;
}

for (let i = 0; i < WARMUP; i += 1) oneFrame();
const samples: number[] = [];
for (let i = 0; i < FRAMES; i += 1) samples.push(oneFrame());
const sorted = samples.toSorted((a, b) => a - b);
const pick = (p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? Number.NaN;
const note = `${String(FRAMES)} frames, 77 extensions, CPU side only (no WebGL, no DOM, no compositing)`;
for (const [metric, value] of [
  ["orbit_frame_cpu_ms_p50", pick(0.5)],
  ["orbit_frame_cpu_ms_p95", pick(0.95)],
  ["orbit_frame_cpu_ms_max", sorted.at(-1) ?? Number.NaN],
] as const) {
  process.stdout.write(
    `${JSON.stringify({ metric, unit: "ms", value: Math.round(value * 1000) / 1000, note })}\n`,
  );
}
