/** v(n) payload → v(n+1) payload. 순수 함수. 저장된 행은 바꾸지 않는다. */
export type Upcaster = (payload: unknown) => unknown;
