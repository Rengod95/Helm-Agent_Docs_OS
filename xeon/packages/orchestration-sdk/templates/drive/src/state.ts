import { Type, type TInteger, type TLiteral, type TObject, type TUnion } from "typebox";

/** 구동 그룹의 상태. 진행은 커밋된 값으로만 정한다(재생 규율) */
export interface State {
  readonly phase: "run" | "done";
  readonly round: number;
}

export const stateSchema: TObject<{
  phase: TUnion<[TLiteral<"run">, TLiteral<"done">]>;
  round: TInteger;
}> = Type.Object({
  phase: Type.Union([Type.Literal("run"), Type.Literal("done")]),
  round: Type.Integer({ minimum: 0 }),
});

export const initialState: State = { phase: "run", round: 0 };
