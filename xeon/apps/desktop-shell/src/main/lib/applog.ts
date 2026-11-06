// 앱 로그 파일(applog.rs). 줄 단위로 덧붙이고 프레임 내용은 쓰지 않는다(L4.desktop.spec E11).
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { ShellContext } from "../context.ts";

export const LOG_FILE_NAME = "fresnel-desktop.log";

export interface AppLog {
  /** 한 줄을 남긴다. 제어 문자(탭 제외)는 공백으로 바꾼다. 쓰지 못하면 표준 오류로 대신한다(로그 때문에 앱이 멈추지 않는다) */
  line(message: string): void;
}

export interface AppLogDeps {
  /** 로그 폴더. null이면 표준 오류만 쓴다 */
  readonly dir: string | null;
  readonly now: () => Date;
  readonly stderr: (text: string) => void;
}

/** 제어 문자를 공백으로 바꾼다. 탭은 둔다 */
export function sanitizeLogLine(message: string): string {
  return message.replaceAll(/\p{Cc}/gu, (char) => (char === "\t" ? char : " "));
}

export function createAppLog(deps: AppLogDeps): AppLog {
  const file = deps.dir === null ? null : path.join(deps.dir, LOG_FILE_NAME);
  if (deps.dir !== null) {
    try {
      mkdirSync(deps.dir, { recursive: true });
    } catch (cause) {
      deps.stderr(`applog: cannot create ${deps.dir}: ${String(cause)}\n`);
    }
  }
  return {
    line(message) {
      const text = `${deps.now().toISOString()} ${sanitizeLogLine(message)}\n`;
      if (file === null) {
        deps.stderr(text);
        return;
      }
      try {
        appendFileSync(file, text);
      } catch (cause) {
        deps.stderr(`applog: cannot write ${LOG_FILE_NAME}: ${String(cause)}\n${text}`);
      }
    },
  };
}

const logs = new WeakMap<ShellContext, AppLog>();

/** ctx마다 앱 로그 하나. 모듈들이 같은 파일을 쓴다 */
export function appLogOf(ctx: ShellContext): AppLog {
  const existing = logs.get(ctx);
  if (existing !== undefined) return existing;
  const created = createAppLog({
    dir: ctx.paths.logs,
    now: () => new Date(),
    stderr: (text) => {
      process.stderr.write(text);
    },
  });
  logs.set(ctx, created);
  return created;
}
