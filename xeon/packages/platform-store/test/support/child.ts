type ChildSignal = "SIGKILL" | "SIGSTOP" | "SIGCONT" | "SIGTERM";

export interface Child {
  readonly pid: number;
  /** 다음 한 줄(개행 제외)을 기다린다. 자식이 끝났으면 null */
  nextLine(): Promise<string | null>;
  /** 한 줄을 보내고 답 한 줄을 기다린다 */
  ask(line: string): Promise<string | null>;
  send(line: string): Promise<void>;
  kill(signal: ChildSignal): void;
  readonly exited: Promise<number | null>;
}

/** 줄 단위로 대화하는 자식 프로세스. 스크립트는 같은 bun으로 돈다 */
export function startChild(script: string, args: readonly string[]): Child {
  const child = Bun.spawn([process.execPath, script, ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, NODE_ENV: "test" },
  });
  const decoder = new TextDecoder();
  const reader = child.stdout.getReader();
  let buffer = "";
  let done = false;

  const nextLine = async (): Promise<string | null> => {
    const newline = buffer.indexOf("\n");
    if (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      return line;
    }
    if (done) return null;
    const chunk = await reader.read();
    if (chunk.done) {
      done = true;
    } else {
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    return nextLine();
  };

  const send = async (line: string): Promise<void> => {
    await child.stdin.write(`${line}\n`);
    await child.stdin.flush();
  };

  return {
    pid: child.pid,
    nextLine,
    send,
    async ask(line: string): Promise<string | null> {
      await send(line);
      return nextLine();
    },
    kill(signal: ChildSignal): void {
      child.kill(signal);
    },
    exited: child.exited,
  };
}
