// 가짜 ShellContext. 모듈 시험이 electron 없이 register(ctx)를 돌린다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { createCommandRegistry, type ShellReply } from "../../src/main/commands.ts";
import type { IpcCaller, ShellChannel, ShellContext } from "../../src/main/context.ts";

interface SentMessage {
  readonly id: number;
  readonly message: unknown;
}

export interface FakeCtx {
  readonly ctx: ShellContext;
  /** 등록된 명령을 부른다(ShellError는 ok:false 응답으로 온다) */
  call(command: string, args?: unknown): Promise<ShellReply>;
  /** ctx.channel이 만든 채널로 간 메시지 */
  readonly sent: SentMessage[];
  readonly emitted: string[];
  readonly opened: string[];
  readonly dialogs: { folder: string | null; file: string | null; save: string | null };
  readonly schemes: Map<string, (request: Request) => Response | Promise<Response>>;
  /** 등록된 종료 정리를 등록 역순으로 돌린다 */
  quit(): Promise<void>;
  /** showMainWindow를 부른 횟수 */
  readonly shown: { count: number };
  readonly dir: string;
  readonly env: Record<string, string | undefined>;
}

export function fakeCtx(
  options: { readonly env?: Record<string, string | undefined> } = {},
): FakeCtx {
  const dir = mkdtempSync(path.join(tmpdir(), "fresnel-shell-test-"));
  const registry = createCommandRegistry();
  const sent: SentMessage[] = [];
  const emitted: string[] = [];
  const opened: string[] = [];
  const cleanups: (() => void | Promise<void>)[] = [];
  const schemes = new Map<string, (request: Request) => Response | Promise<Response>>();
  const dialogs: { folder: string | null; file: string | null; save: string | null } = {
    folder: null,
    file: null,
    save: null,
  };
  const env: Record<string, string | undefined> = { ...options.env };
  const caller: IpcCaller = { sender: Object.create(null) };
  const windows: BrowserWindow[] = [];
  const shown = { count: 0 };
  const ctx: ShellContext = {
    env,
    platform: "darwin",
    paths: {
      userData: path.join(dir, "user-data"),
      configDir: path.join(dir, "config"),
      logs: path.join(dir, "logs"),
      resources: path.join(dir, "resources"),
      ui: path.join(dir, "ui"),
    },
    dialogs: {
      openFolder: async () => dialogs.folder,
      openFile: async () => dialogs.file,
      saveFile: async () => dialogs.save,
    },
    openExternal: async (url) => {
      opened.push(url);
    },
    handle: (command, handler) => {
      registry.handle(command, handler);
    },
    channel(_caller, value): ShellChannel | null {
      if (typeof value !== "object" || value === null) return null;
      const id: unknown = Object.getOwnPropertyDescriptor(value, "$channel")?.value;
      if (typeof id !== "number") return null;
      return {
        send(message) {
          sent.push({ id, message });
        },
      };
    },
    emit: (name) => {
      emitted.push(name);
    },
    showMainWindow: () => {
      shown.count += 1;
    },
    onQuit: (cleanup) => {
      cleanups.unshift(cleanup);
    },
    handleScheme: (scheme, handler) => {
      schemes.set(scheme, handler);
    },
    windows: () => windows,
    windowOptions: () => undefined,
    onWindow: () => undefined,
  };
  return {
    ctx,
    call: (command, args) => registry.dispatch(caller, command, args),
    sent,
    emitted,
    opened,
    dialogs,
    schemes,
    quit: async () => {
      await cleanups.reduce<Promise<void>>(async (previous, cleanup) => {
        await previous;
        await cleanup();
      }, Promise.resolve());
    },
    shown,
    dir,
    env,
  };
}
