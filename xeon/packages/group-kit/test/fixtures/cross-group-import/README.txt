check-layers DR-02 입력 샘플(L3.group-kit.plan G-21). 워크스페이스에 넣지 않는다.
.txt 소스는 test/comms.test.ts가 임시 디렉터리에 가짜 xeon 작업 트리로 풀어 놓고 scripts/check-layers.ts를 돌린다.
확장자를 .txt로 둔 이유는 실제 check-layers가 이 패키지의 소스를 읽을 때 샘플 import를 위반으로 세지 않게 하기 위해서다.
