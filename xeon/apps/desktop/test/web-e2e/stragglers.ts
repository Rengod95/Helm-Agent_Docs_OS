import { attempt } from "@fresnel/contracts";

// 시험이 끝난 뒤 이 프로세스의 자손으로 남은 프로세스(헤드리스 Chrome, 게이트웨이, 서비스)를 찾아 죽인다. 죽인 뒤에도 남은 것만 돌려주므로 정상이면 빈 목록이다.
// 지난번 headless Chrome 23개가 며칠 남아 부하를 만든 일이 있어 시험이 끝에서 꼭 확인한다.

interface Row {
  readonly pid: number;
  readonly command: string;
}

function descendants(root: number): readonly Row[] {
  const listing = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,command="]);
  const rows = new Map<number, { readonly ppid: number; readonly command: string }>();
  for (const line of listing.stdout.toString().split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
    if (match === null) continue;
    rows.set(Number(match[1]), { ppid: Number(match[2]), command: match[3] ?? "" });
  }
  const found: Row[] = [];
  const queue = [root];
  for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
    for (const [child, row] of rows) {
      // 자기 자신이 부른 ps와 이미 끝나 수거를 기다리는 프로세스는 센 것이 아니다
      if (row.ppid !== pid || row.command.startsWith("ps ") || row.command.includes("<defunct>"))
        continue;
      found.push({ pid: child, command: row.command.slice(0, 120) });
      queue.push(child);
    }
  }
  return found;
}

/** 자손을 모두 죽이고(SIGTERM, 2초 뒤 SIGKILL) 그래도 남은 것을 돌려준다 */
export function killStragglers(): readonly string[] {
  Bun.WebView.closeAll();
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    const deadline = Date.now() + 2_000;
    for (;;) {
      const rows = descendants(process.pid);
      if (rows.length === 0) return [];
      if (Date.now() > deadline) break;
      for (const row of rows) attempt(() => process.kill(row.pid, signal));
      Bun.sleepSync(200);
    }
  }
  return descendants(process.pid).map((row) => `${String(row.pid)} ${row.command}`);
}
