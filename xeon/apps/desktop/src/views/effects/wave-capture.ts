// 물결 렌즈가 읽을 창 그림(DP-166). 화면(DOM)은 셰이더에서 읽을 수 없으므로 데스크톱 셸이 창을 한 장 찍어(`window_capture`) 넘긴다.
// 굴절·흐림을 그릴지는 이 파일 한 곳에서 정한다: 진입점(main.tsx)이 Electron 창일 때만 `installWaveCapture`로 찍는 함수를 넣는다.
// 웹 게이트웨이(브라우저 탭)는 넣지 않아 색 물결과 입자만 돈다. 찍기가 한도(`WAVE_CAPTURE_LIMIT_MS`)를 넘거나 실패해도 같다.

/** 찍은 창 한 장. 장치 px, BGRA 8비트, 위 줄부터 */
export type WaveSnapshot = {
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
  /** 찍기를 부른 때부터 받은 때까지(ms) */
  readonly ms: number;
};

/**
 * 찍기를 기다리는 상한(ms). 물결은 그림을 받은 뒤에 시작하므로 이만큼 늦을 수 있다. 사람이 "누른 뒤 바로"로 느끼는 100ms 언저리에
 * 첫 0.3초가 모으기(anticipation)라 조금 더 둔다. 실측(1100×760 창, 2배, 70~81ms)은 시안 dzU2 §6
 */
const WAVE_CAPTURE_LIMIT_MS = 180;

type CaptureFn = () => Promise<unknown>;

let capture: CaptureFn | null = null;

/** 찍는 함수를 넣는다(Electron 창의 진입점에서 한 번). null이면 뺀다 */
export function installWaveCapture(fn: CaptureFn | null): void {
  capture = fn;
}

/** 이 화면에서 렌즈(굴절·흐림)를 그릴 수 있는가 */
export function waveLensAvailable(): boolean {
  return capture !== null;
}

function field(value: unknown, name: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const found: unknown = Object.getOwnPropertyDescriptor(value, name)?.value;
  return found;
}

/** 셸의 답을 좁힌다. 모양이 다르거나 바이트 수가 크기와 맞지 않으면 null */
export function snapshotOf(reply: unknown, ms: number): WaveSnapshot | null {
  const width = field(reply, "width");
  const height = field(reply, "height");
  const bytes = field(reply, "bytes");
  if (field(reply, "format") !== "bgra") return null;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    return null;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== width * height * 4) return null;
  return { width, height, bytes, ms };
}

/** 창을 찍는다. 찍는 함수가 없거나, 실패하거나, `limitMs` 안에 오지 않으면 null(늦게 온 그림은 버린다) */
export async function captureForWave(
  limitMs: number = WAVE_CAPTURE_LIMIT_MS,
  now: () => number = () => performance.now(),
): Promise<WaveSnapshot | null> {
  const fn = capture;
  if (fn === null) return null;
  const started = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, limitMs);
  });
  // 장식이라 실패는 알릴 곳이 없다: 실패는 "굴절 없이 색 물결"로 바뀐다(시안 dzU2 §3.4)
  const taken = fn().then(
    (reply) => snapshotOf(reply, now() - started),
    () => null,
  );
  const result = await Promise.race([taken, late]);
  clearTimeout(timer);
  return result;
}
