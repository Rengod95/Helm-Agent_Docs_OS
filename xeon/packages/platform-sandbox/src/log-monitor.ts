import { spawnSync } from "node:child_process";

// srt(macOS)는 위반 감시용 `log stream ... _SBX` 자식을 띄우고 reset()에서만 끈다.
// 호스트가 SIGKILL로 죽거나 reset 없이 끝나면 자식이 부모 없이 남아 load를 올린다(2026-11-12 110개).
// srt 안의 자식 핸들에 접근할 수 없으므로 ps로 찾아서 끝날 때 정리하고, 시작할 때 부모 없는 것을 거둔다.

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
}

const MONITOR_COMMAND = /^(?:\S*\/)?log stream .*_SBX"\)? /;

/** `ps -axo pid=,ppid=,command=` 출력을 행으로 바꾼다. 형식이 틀린 줄은 버린다 */
export function parseProcessRows(output: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match === null) continue;
    const [, pid, ppid, command] = match;
    if (pid === undefined || ppid === undefined || command === undefined) continue;
    rows.push({ pid: Number(pid), ppid: Number(ppid), command });
  }
  return rows;
}

export function isLogMonitorCommand(command: string): boolean {
  return MONITOR_COMMAND.test(`${command} `);
}

/** parentPid의 직계 자식인 위반 감시 pid. parentPid가 1이면 부모 없이 남은 것을 뜻한다 */
export function selectLogMonitors(rows: readonly ProcessRow[], parentPid: number): number[] {
  return rows
    .filter((row) => row.ppid === parentPid && isLogMonitorCommand(row.command))
    .map((row) => row.pid);
}

function readRows(): ProcessRow[] {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" });
  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  return parseProcessRows(result.stdout);
}

/** SIGTERM을 보낸다. 이미 끝났거나 우리 것이 아닌 pid는 건너뛰고 건너뛴 수를 돌려준다 */
function terminate(pids: readonly number[]): number {
  let skipped = 0;
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (caught) {
      if (caught instanceof Error) skipped += 1;
    }
  }
  return skipped;
}

export interface LogMonitorGuard {
  /** 초기화 직후 부른다: 부모 없는 감시를 거두고, 이 프로세스의 감시를 추적하며 종료 훅을 건다 */
  arm(): void;
  /** 지금 이 프로세스의 감시 자식을 모두 끈다(동기) */
  sweep(): void;
}

/** 위반 감시는 srt가 macOS에서만 띄운다(initialize의 enableLogMonitor). 다른 OS에서는 찾을 것이 없어 아무 일도 하지 않는다 */
export function createLogMonitorGuard(ownPid: number = process.pid): LogMonitorGuard {
  let hooked = false;
  const sweep = (): void => {
    terminate(selectLogMonitors(readRows(), ownPid));
  };
  return {
    sweep,
    arm: () => {
      // 부모가 죽어 pid 1에 붙은 감시는 어느 프로세스의 것도 아니다. 살아 있는 감시는 부모가 있다
      terminate(selectLogMonitors(readRows(), 1));
      if (hooked) return;
      hooked = true;
      // exit는 정상 종료와 process.exit(시그널 처리기 포함)에서 불린다. 동기 작업만 한다
      process.on("exit", sweep);
    },
  };
}
