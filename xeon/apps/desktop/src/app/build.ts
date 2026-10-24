// 빌드 상수. `bun build --define __XEON_CHECKS__=true`가 개발 빌드에서 불변식 검사 단계를 켠다(design 11.1, 14절 6번).
// 정의되지 않은 환경(시험)에서는 false다.
// oxlint-disable-next-line no-underscore-dangle -- bun build --define이 치환하는 빌드 상수의 관례 이름이다 (L4.desktop.design 11.1)
declare const __XEON_CHECKS__: boolean | undefined;

export const BUILD_CHECKS: boolean = typeof __XEON_CHECKS__ === "boolean" && __XEON_CHECKS__;
