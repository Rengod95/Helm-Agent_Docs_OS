// Plugin App 한 장짜리 예제. 호스트와 만나는 순서는 이렇다.
//  1. 프레임이 뜨면 부모 창에 준비 신호 `{ v: 1, ready: true, bridge: "^1.0.0" }`를 보낸다(맨 아래 줄).
//     `bridge`는 plugin.json `app.bridge`와 같은 범위다.
//  2. 호스트가 준비 신호를 받으면 `message` 이벤트로 MessagePort 하나를 넘긴다(`event.ports[0]`).
//     그 뒤 모든 말은 이 포트로 한다. 요청은 `{ v: 1, id, op, args }`, 응답은 같은 `id`를 단 객체다.
//  3. 호스트가 `{ push: "ping", value: { n } }`를 밀어 보내면 `op: "pong"` 요청으로 `n`을 돌려준다.
// 격리 때문에 fetch, localStorage, window.top은 쓸 수 없다. 필요한 것은 다리 `op`(settings, query 등)로 묻는다.
const status = document.getElementById("status");
let port;
let nextId = 1;

window.addEventListener("message", (event) => {
  if (port || event.ports.length === 0) return;
  port = event.ports[0];
  status.textContent = "connected";
  port.onmessage = (message) => {
    const data = message.data;
    if (data && data.push === "ping") {
      port.postMessage({ v: 1, id: nextId++, op: "pong", args: { n: data.value.n } });
      status.textContent = "ping " + data.value.n;
    }
  };
});

window.parent.postMessage({ v: 1, ready: true, bridge: "^1.0.0" }, "*");
