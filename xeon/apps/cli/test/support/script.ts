// 대화형 입력 대본. 프롬프트마다 다음 답을 꺼낸다. BLOCK은 abort될 때까지 기다린다(다른 곳에서 먼저 답하는 시험)

/** abort될 때까지 기다리는 답 */
export const BLOCK: { readonly block: true } = { block: true };

export type Reply = string | null | typeof BLOCK;

export interface ScriptedInput {
  readLine(prompt: string, signal: AbortSignal): Promise<string | null>;
  /** 지금까지 받은 프롬프트 문구 */
  readonly prompts: string[];
}

export function scriptedInput(replies: readonly Reply[]): ScriptedInput {
  const queue = [...replies];
  const prompts: string[] = [];
  return {
    prompts,
    readLine(prompt, signal) {
      prompts.push(prompt);
      const next = queue.shift();
      if (next === undefined || next === null) return Promise.resolve(null);
      if (typeof next === "string") return Promise.resolve(next);
      return new Promise<string | null>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            resolve(null);
          },
          { once: true },
        );
      });
    },
  };
}
