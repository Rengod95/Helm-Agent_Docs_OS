// Plugin App 다리. 셸과 준비 신호를 맞추고, 요청에 id를 붙여 응답을 받고, 셸이 보내는 푸시를 나눠 준다.
// 앱 코드는 query, call, navigate와 invalidate 받기만 쓴다. 판정은 셸과 엔진이 한다(ADR-0021 §3.4).
(function () {
  const BRIDGE_RANGE = "^1.0.0";
  const nonce = new URLSearchParams(location.hash.slice(1)).get("n");
  const pending = new Map();
  const invalidateListeners = [];
  let port = null;
  let nextId = 1;
  let markConnected;
  const connected = new Promise((resolve) => {
    markConnected = resolve;
  });

  function applyTheme(theme) {
    const root = document.documentElement;
    root.style.colorScheme = theme.scheme;
    for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty(name, value);
  }

  function onMessage(message) {
    const data = message.data;
    if (data === null || typeof data !== "object") return;
    if (data.push === "theme") applyTheme(data.value);
    else if (data.push === "invalidate") invalidateListeners.forEach((listener) => listener());
    // 생존 확인에는 답만 하면 된다. 응답을 기다리지 않으므로 요청 id 장부에 넣지 않는다
    else if (data.push === "ping")
      port.postMessage({ v: 1, id: nextId++, op: "pong", args: { n: data.value.n } });
    else if (data.id !== undefined && pending.has(data.id)) {
      const waiter = pending.get(data.id);
      pending.delete(data.id);
      if (data.ok) waiter.resolve(data.value);
      else waiter.reject(data.error);
    }
  }

  function request(op, args) {
    return connected.then(
      () =>
        new Promise((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          port.postMessage({ v: 1, id, op, args });
        }),
    );
  }

  window.addEventListener("message", (event) => {
    if (port !== null || event.ports.length === 0) return;
    port = event.ports[0];
    port.onmessage = onMessage;
    markConnected();
  });

  const ready = { v: 1, ready: true, bridge: BRIDGE_RANGE };
  if (nonce !== null) ready.nonce = nonce;
  window.parent.postMessage(ready, "*");

  window.FresnelBridge = {
    /** 자기 읽기 메서드를 부른다. 값은 메서드의 결과다 */
    query: (verb, params) => request("query", params === undefined ? { verb } : { verb, params }),
    /** 자기 쓰기 메서드를 부른다. 셸은 누를 때마다 확인 줄을 띄운다 */
    call: (verb, params) => request("call", params === undefined ? { verb } : { verb, params }),
    /** 앱 안의 다른 화면, 대화, 외부 링크를 연다. 목표 모양은 contracts 다리 navigate 인자다 */
    navigate: (target) => request("navigate", { target }),
    /** 엔진 상태가 바뀌면 셸이 invalidate를 보낸다. 그때 이 함수가 불린다 */
    onInvalidate: (listener) => {
      invalidateListeners.push(listener);
    },
  };
})();
