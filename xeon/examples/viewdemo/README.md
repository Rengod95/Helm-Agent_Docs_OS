# viewdemo

`app` 프레임 화면(Plugin App)과 native 화면을 하나씩 가진 예제 확장이다. 준비 신호(ready)와 ping/pong은 `ui/app/app.js` 주석에 있다.
설치는 확장 폴더로 이 디렉터리를 넣으면 된다(앱 설정 `x.ui.apps`가 켜져 있어야 프레임이 뜬다).

프레임은 주소 조각 `#n=<nonce>`의 값을 읽어 준비 신호 `ready`에 `nonce`로 되돌려야 연결된다(없으면 "준비 신호의 모양이 규약과 달라 닫혔어요"). 모양은 `ui/app/app.js` 맨 위 주석과 맨 아래 줄에 있다.
