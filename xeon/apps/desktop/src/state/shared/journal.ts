// src/state/shared/journal.ts
/** 기록에 들어가는 입력 설명. 고정 이름과 숫자만 둔다. 대화 내용, 경로, 설정 값은 넣지 않는다 */
export type JournalLabel = { readonly input: string; readonly seq: number | null };

export type JournalEntry<N extends string> =
  | ({ readonly kind: "input"; readonly at: number; readonly note: N } & JournalLabel)
  | { readonly kind: "flush"; readonly at: number; readonly count: number; readonly ms: number };

export interface Journal<N extends string> {
  record(entry: JournalEntry<N>): void;
  /** 오래된 것부터 새 배열로 돌려준다 */
  entries(): readonly JournalEntry<N>[];
}

/** 고정 크기 링 버퍼. 가득 차면 가장 오래된 기록을 덮어쓴다 */
export function createJournal<N extends string>(capacity: number): Journal<N> {
  const slots: (JournalEntry<N> | undefined)[] = Array.from({ length: capacity }, () => undefined);
  let next = 0;
  let size = 0;
  return {
    record(entry) {
      slots[next] = entry;
      next = (next + 1) % capacity;
      size = Math.min(size + 1, capacity);
    },
    entries() {
      const out: JournalEntry<N>[] = [];
      for (let i = 0; i < size; i += 1) {
        const entry = slots[(next - size + i + capacity) % capacity];
        if (entry !== undefined) out.push(entry);
      }
      return out;
    },
  };
}
