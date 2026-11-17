import { expect, test } from "bun:test";
import { hostGroupsPlugin, type HostGroupsOptions } from "../../src/assembly/groups.ts";
import { partial } from "../fixtures/unsafe.ts";

// 그룹 서비스 단위(`host-groups`)의 모양. 서비스는 `onService`로 넘기고 중재 포트와 구동 그룹 설정은 없다(E3, drive-isolation.md 2.2).
// 서비스 동작은 `test/int/groups.int.test.ts`가 실제 조립으로 본다.

test("the group service unit is a built-in host unit named host-groups, loading at the given index", () => {
  const unit = hostGroupsPlugin(partial<HostGroupsOptions>({ loadIndex: 3 }));
  expect(unit.manifest.name).toBe("host-groups");
  expect(unit.builtin).toBe(true);
  expect(unit.loadIndex).toBe(3);
});
