// 테스트용 확장 호스트와 대역. 내용은 src/primitives/testing/ 안에 있다(X.primitives.plan §2).
export * from "../primitives/testing/index.ts";

// 포트 키로 보관한 값을 키의 타입으로 되돌린다. PlatformContext 대역이 port()를 구현할 때 쓴다(TY-06 허용 목록 A3)
export { portAs } from "../erase.ts";
