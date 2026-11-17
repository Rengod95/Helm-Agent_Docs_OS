// 플러그인 호스트 시험 공용 대역: 메모리 입력(바이트를 넣고 닫는다), 줄 수집기(응답 기다리기), 엔트리 파일 쓰기.
// 시험은 실제 프로세스 대신 이 대역으로 `runPluginHost`를 돌린다. 프레임은 줄을 읽어 검증한 뒤 본다.
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, parseJson } from "@fresnel/contracts";
import {
  PLUGIN_HOST_PROTOCOL_VERSION,
  RawPluginHostFrameSchema,
  type RawPluginHostFrame,
} from "@fresnel/contracts/extensions";
import * as extHost from "../../../src/index.ts";
import { runPluginHost, type PluginHostExit } from "../../../src/isolation/child-runtime.ts";

/** 바이트를 넣고 닫을 수 있는 입력. 읽는 쪽은 AsyncIterable로 본다 */
export interface MemoryInput extends AsyncIterable<Uint8Array> {
  push(text: string): void;
  end(): void;
}

export function memoryInput(): MemoryInput {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  const signal = (): void => {
    const resume = wake;
    wake = undefined;
    resume?.();
  };
  return {
    push(text) {
      chunks.push(encoder.encode(text));
      signal();
    },
    end() {
      closed = true;
      signal();
    },
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<Uint8Array>>((resolve) => {
          const attempt = (): void => {
            const chunk = chunks.shift();
            if (chunk !== undefined) {
              resolve({ done: false, value: chunk });
              return;
            }
            if (closed) {
              resolve({ done: true, value: undefined });
              return;
            }
            wake = attempt;
          };
          attempt();
        }),
    }),
  };
}

/** 줄 수집기. 쓰인 줄을 보관하고, 조건에 맞는 프레임이 나올 때까지 기다린다 */
interface Outbox {
  write(line: string): void;
  readonly lines: string[];
  waitFor(match: (frame: RawPluginHostFrame) => boolean): Promise<RawPluginHostFrame>;
  /** 진단 줄처럼 프레임이 아닌 줄을 기다린다. 포함한 문자열이 있는 첫 줄을 돌려준다 */
  waitForText(contains: string): Promise<string>;
}

/** 줄 하나를 프레임으로 읽는다. 시험 대역이라 틀리면 던진다 */
export function frameOf(line: string): RawPluginHostFrame {
  const json = parseJson(line);
  if (!json.ok) throw new Error(`test output is not JSON: ${line.slice(0, 200)}`);
  const frame = parse(RawPluginHostFrameSchema, json.value);
  if (!frame.ok) throw new Error(`test output is not a frame: ${line.slice(0, 200)}`);
  return frame.value;
}

function outbox(): Outbox {
  const lines: string[] = [];
  const waiters: (() => void)[] = [];
  return {
    lines,
    write(line) {
      lines.push(line);
      for (const wake of waiters.splice(0)) wake();
    },
    waitFor(match) {
      return new Promise((resolve) => {
        const scan = (): void => {
          const found = lines.map(frameOf).find(match);
          if (found !== undefined) resolve(found);
          else waiters.push(scan);
        };
        scan();
      });
    },
    waitForText(contains) {
      return new Promise((resolve) => {
        const scan = (): void => {
          const found = lines.find((line) => line.includes(contains));
          if (found !== undefined) resolve(found);
          else waiters.push(scan);
        };
        scan();
      });
    },
  };
}

/** 실행 중인 호스트 한 개: 입력(엔진이 보낸 것), 출력(엔진이 받은 것), 진단, 종료 약속 */
export interface RunningHost {
  readonly input: MemoryInput;
  readonly out: Outbox;
  readonly diagnostics: Outbox;
  readonly exit: Promise<PluginHostExit>;
  send(frame: object): void;
}

/** `@fresnel/ext-host`를 플러그인이 `hostOf`로 쓸 수 있게 SDK 가상 모듈로 넘긴다. 같은 모듈 인스턴스다 */
export function startHost(): RunningHost {
  const input = memoryInput();
  const out = outbox();
  const diagnostics = outbox();
  const exit = runPluginHost({
    input,
    output: out,
    stderr: diagnostics,
    sdkModules: { "@fresnel/ext-host": extHost },
  });
  return {
    input,
    out,
    diagnostics,
    exit,
    send: (frame) => {
      input.push(`${JSON.stringify(frame)}\n`);
    },
  };
}

/** 시험용 매니페스트. 루트 플러그인 하나이고 시험 엔트리가 쓰는 훅 이름을 적는다 */
const MANIFEST = {
  schemaVersion: 2,
  name: "demo",
  version: "1.0.0",
  entry: "./src/index.ts",
  plugins: [
    {
      layer: "plugin",
      hooks: [
        "tool.call.before",
        "request.context.before",
        "boundary.turn.before",
        "boundary.settle.after",
        "boundary.step.after",
        "request.stream",
      ],
    },
  ],
} as const;

/** host.init params. `root`는 엔트리를 쓴 디렉터리다 */
export function initParams(root: string, settings: Readonly<Record<string, unknown>> = {}): object {
  return {
    protocolVersion: PLUGIN_HOST_PROTOCOL_VERSION,
    extension: "demo",
    versionId: "v1",
    manifest: MANIFEST,
    root,
    entry: "./src/index.ts",
    settings,
  };
}

/** 시험에서 쓰는 대화 id. ULID 모양(26자)을 지킨다 */
export const THREAD_ID = "thr_01111111111111111111111111";

const tempRoots: string[] = [];

/** 엔트리 본문을 가진 임시 확장 루트를 만든다. `cleanupTempRoots`가 지운다 */
export async function writePluginRoot(entrySource: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "fresnel-isolation-")));
  tempRoots.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "index.ts"), entrySource);
  return root;
}

export async function cleanupTempRoots(): Promise<void> {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}
