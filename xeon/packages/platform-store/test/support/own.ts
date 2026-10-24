type Resource = AsyncDisposable | Disposable;

const owned: Resource[] = [];

/**
 * 테스트가 끝나면 닫을 자원을 등록한다. 쓰는 테스트 파일은 최상위에서 `afterEach(releaseOwned)`를 한 번 건다
 * (이 모듈은 파일 사이에 공유되므로 여기서 훅을 걸면 처음 부른 파일에만 걸린다). `using` 선언 대신 쓴다(dependency-cruiser의 swc 파서가
 * UsingDeclaration을 읽지 못한다). 등록의 역순으로 닫는다.
 */
export function own<T extends Resource>(resource: T): T {
  owned.push(resource);
  return resource;
}

export async function releaseOwned(): Promise<void> {
  const resources = owned.splice(0).toReversed();
  await Promise.all(
    resources.map(async (resource) => {
      if (Symbol.asyncDispose in resource) await resource[Symbol.asyncDispose]();
      else resource[Symbol.dispose]();
    }),
  );
}
