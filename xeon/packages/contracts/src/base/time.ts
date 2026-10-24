import { Type, type TInteger } from "typebox";

/** Unix epoch 밀리초. 2001-09-09 이후, 9999-12-31 이전 */
export const EpochMsSchema: TInteger = Type.Integer({
  minimum: 1_000_000_000_000,
  maximum: 253_402_300_799_999,
});
