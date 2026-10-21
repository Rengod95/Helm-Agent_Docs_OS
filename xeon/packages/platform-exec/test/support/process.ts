import { execFileSync } from "node:child_process";

/** 프로세스 그룹 id에 속한 프로세스 수. `ps -A -o pgid=` 출력에서 센다(macOS·Linux 공통) */
export function groupProcessCount(pgid: number): number {
  const out = execFileSync("ps", ["-A", "-o", "pgid="], { encoding: "utf8" });
  return out.split("\n").filter((line) => line.trim() === String(pgid)).length;
}

/** 조건이 참이 될 때까지 짧게 쉬며 기다린다. 벽시계 대신 횟수로 상한을 둔다 */
export async function pollUntil(
  condition: () => boolean,
  attempts: number,
  stepMs = 20,
): Promise<boolean> {
  if (condition()) return true;
  if (attempts <= 0) return false;
  await new Promise((resolve) => setTimeout(resolve, stepMs));
  return pollUntil(condition, attempts - 1, stepMs);
}

/** pid가 살아 있는가 */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
