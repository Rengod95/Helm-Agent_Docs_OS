import { Type, type TInteger, type TObject } from "typebox";

/** 관찰 그룹의 상태. 지금까지 세어 본 턴 수다 */
export interface State {
  readonly count: number;
}

export const stateSchema: TObject<{ count: TInteger }> = Type.Object({
  count: Type.Integer({ minimum: 0 }),
});

export const initialState: State = { count: 0 };
