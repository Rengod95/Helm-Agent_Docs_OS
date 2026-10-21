export interface Finished {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** 이 프로세스와 같은 bun으로 스크립트를 자식 프로세스로 돌려 끝날 때까지 기다린다 */
export async function runScript(script: string, args: readonly string[] = []): Promise<Finished> {
  const child = Bun.spawn([process.execPath, script, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NODE_ENV: "test" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}
