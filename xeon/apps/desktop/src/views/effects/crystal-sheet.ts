// 이 파일은 scripts/crystal-bake.ts가 만든다(`just desktop-crystal-bake`). 손으로 고치지 않는다.
// 크리스탈 표시의 스프라이트 판(crystal-dark.png, crystal-light.png) 배치표(DP-223, lcMk3).

/** 판의 줄 하나: 칸 한 변(기기 px), 판 안의 윗변, 쉬는 틈의 반폭(모형 단위) */
export interface CrystalSheetRow {
  readonly box: number;
  readonly top: number;
  readonly half: number;
}

/** 판 배치. 칸 k(0부터)는 자세 floor(k / 2)의 조각 k % 2이고 왼쪽에서 k × box에 있다 */
export const CRYSTAL_SHEET: {
  readonly width: number;
  readonly height: number;
  readonly rows: readonly CrystalSheetRow[];
  readonly yaws: readonly number[];
  readonly apart: readonly (readonly [number, number])[];
  readonly halfExtent: number;
} = {
  width: 640,
  height: 132,
  rows: [
    { box: 28, top: 0, half: 0.1852 },
    { box: 40, top: 28, half: 0.1296 },
    { box: 64, top: 68, half: 0.1525 },
  ],
  yaws: [-0.25, 0, 0.14, 0.35, 0.6],
  apart: [
    [0.813, -0.3621],
    [0.8705, -0.4018],
    [0.8836, -0.43],
    [0.877, -0.4791],
    [0.8283, -0.5453],
  ],
  halfExtent: 1.3473,
};
