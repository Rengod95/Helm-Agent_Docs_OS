// @xeon/group-kit/testing. 다른 패키지의 testing 서브패스를 import하지 않는다(DR-08).
export { checkGroup } from "./check-group.ts";
export {
  SMOKE_GROUP_MANIFEST,
  smokeGroup,
  type SmokeGroup,
  type SmokeGroupOptions,
  type SmokeGroupProbe,
  type SmokeGroupState,
} from "./smoke-group.ts";
