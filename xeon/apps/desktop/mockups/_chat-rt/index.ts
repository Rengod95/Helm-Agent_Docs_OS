// batch A 공용(목업 전용): 대화 영역 런타임 시나리오 페이지(a00~a04)가 같이 쓰는 무대 부품, 런타임 탭, 상태 기계.
// 페이지 mockup.css에 `@source "../_chat-rt/";`와 `@source "../p02-opus/parts/";`를 더해야 Tailwind가 이 클래스를 만든다.
export * from "./chat";
export * from "./machine";
export * from "./runtime-panel";
export * from "./items";
export * from "./thread-t1";
