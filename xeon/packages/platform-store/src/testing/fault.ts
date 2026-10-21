import { Bug } from "@xeon/contracts";
import type { FaultInjector, FaultPoint } from "@xeon/contracts/records";
import {
  NO_STORE_FAULTS,
  STORE_FAULT_POINTS,
  type StoreFaultInjector,
  type StoreFaultPoint,
} from "../fault-points.ts";

export { NO_STORE_FAULTS, STORE_FAULT_POINTS, type StoreFaultInjector, type StoreFaultPoint };

/** 지점 하나에서 예외를 던지는 주입기. armed를 false로 두면 아무것도 하지 않는다 */
export interface ArmedFault<I> {
  armed: boolean;
  readonly injector: I;
}

/** F FaultPoint 하나에서 Bug(`fault:<지점>`)를 던진다(eng.testing.guide TS-08) */
export function faultAt(point: FaultPoint): ArmedFault<FaultInjector> {
  const state: ArmedFault<FaultInjector> = {
    armed: true,
    injector: {
      hit: (hit: FaultPoint): void => {
        if (state.armed && hit === point) throw new Bug(`fault:${hit}`);
      },
    },
  };
  return state;
}

/** 이 패키지 전용 지점(StoreFaultPoint) 하나에서 Bug(`fault:<지점>`)를 던진다 */
export function storeFaultAt(point: StoreFaultPoint): ArmedFault<StoreFaultInjector> {
  const state: ArmedFault<StoreFaultInjector> = {
    armed: true,
    injector: {
      hit: (hit: StoreFaultPoint): void => {
        if (state.armed && hit === point) throw new Bug(`fault:${hit}`);
      },
    },
  };
  return state;
}
