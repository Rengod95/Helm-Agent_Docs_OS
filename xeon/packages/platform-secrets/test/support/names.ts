import { Bug } from "@xeon/contracts";
import type { SecretHandle, SecretName } from "@xeon/contracts/capabilities";
import { handleForName } from "../../src/ref.ts";

/** 검증을 거친 SecretName. 잘못된 이름은 테스트 픽스처 결함이므로 Bug */
export function nameOf(name: string): SecretName {
  const parsed = handleForName(name);
  if (!parsed.ok) throw new Bug(`test fixture name invalid: ${name}`);
  return parsed.value.name;
}

export function handleOf(name: string): SecretHandle {
  const parsed = handleForName(name);
  if (!parsed.ok) throw new Bug(`test fixture name invalid: ${name}`);
  return parsed.value.handle;
}
