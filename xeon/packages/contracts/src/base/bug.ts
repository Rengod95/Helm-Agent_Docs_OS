/** 버그를 나타내는 유일한 throw 대상. 예상 가능한 실패에는 쓰지 않는다. */
export class Bug extends Error {
  override readonly name: string = "Bug";
}

/** 판별 유니온의 남은 변형이 없음을 컴파일 시점에 확인한다. 런타임에 호출되면 버그다. */
export function assertNever(value: never, where: string): never {
  throw new Bug(`unreachable variant in ${where}`, { cause: value });
}
