// 칸반 화면 한 장. 보드를 메서드 board로 읽어 세 칸에 그리고, 카드를 끌어 다른 칸에 놓으면 move를 부른다.
// 입력한 제목은 add로 보낸다. 엔진 상태가 바뀌면 셸이 invalidate를 보내므로 그때 board를 다시 읽는다.
// 화면은 상태를 들고 있지 않는다. 모든 변화는 엔진이 정하고, 화면은 돌아온 목록을 그린다.
(function () {
  const REASONS = {
    not_found: "카드를 찾지 못했어요",
    full: "카드가 가득 찼어요",
    no_thread: "대화가 열려 있지 않아요",
    invalid_params: "자리 값이 올바르지 않아요",
  };
  const form = document.getElementById("add-form");
  const input = document.getElementById("title-input");
  const status = document.getElementById("status");
  const columns = [...document.querySelectorAll(".column")];
  const lists = {};
  for (const list of document.querySelectorAll(".column-list")) lists[list.dataset.column] = list;
  // 끌고 있는 카드의 id. 끌기가 끝나면 비운다
  let dragging = null;

  function reasonOf(error) {
    return (error && error.kind) || "failed";
  }

  function textOf(reason) {
    return REASONS[reason] || reason;
  }

  function cardElement(card) {
    const item = document.createElement("li");
    item.className = "card";
    item.draggable = true;
    item.dataset.id = card.id;
    item.textContent = card.title;
    item.addEventListener("dragstart", (event) => {
      dragging = card.id;
      item.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", card.id);
    });
    return item;
  }

  function render(cards) {
    for (const name of Object.keys(lists)) {
      const own = cards
        .filter((card) => card.column === name)
        .toSorted((a, b) => a.order - b.order);
      const items = own.map(cardElement);
      if (items.length === 0) {
        const empty = document.createElement("li");
        empty.className = "card-empty";
        empty.textContent = "카드가 없어요";
        items.push(empty);
      }
      lists[name].replaceChildren(...items);
    }
  }

  // 놓은 자리: 끌고 있는 카드를 뺀 카드들 가운데 중앙선보다 위에 있는 수. 옮기기 함수의 index와 같은 뜻이다
  function indexAt(list, y) {
    return [...list.querySelectorAll(".card")]
      .filter((element) => element.dataset.id !== dragging)
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return y > box.top + box.height / 2;
      }).length;
  }

  async function moveTo(id, column, index) {
    try {
      const result = await FresnelBridge.call("move", { id, column, index });
      if (result.ok) {
        render(result.cards);
        status.textContent = "";
      } else {
        status.textContent = "옮기지 못했어요(" + textOf(result.reason) + ")";
      }
    } catch (error) {
      status.textContent = "옮기지 못했어요(" + reasonOf(error) + ")";
    }
  }

  async function refresh() {
    try {
      const result = await FresnelBridge.query("board");
      if (result.ok) render(result.cards);
      status.textContent = "";
    } catch (error) {
      status.textContent = "보드를 읽지 못했어요(" + reasonOf(error) + ")";
    }
  }

  // 끌기가 어떻게 끝나든(놓기, 밖에 놓기, 중간에 다시 그려짐) 끌기 상태와 칸 강조를 지운다
  document.addEventListener("dragend", () => {
    dragging = null;
    for (const element of document.querySelectorAll(".is-dragging"))
      element.classList.remove("is-dragging");
    for (const column of columns) column.classList.remove("is-over");
  });

  for (const column of columns) {
    const name = column.dataset.column;
    column.addEventListener("dragover", (event) => {
      if (dragging === null) return;
      event.preventDefault();
      column.classList.add("is-over");
    });
    column.addEventListener("dragleave", (event) => {
      if (!column.contains(event.relatedTarget)) column.classList.remove("is-over");
    });
    column.addEventListener("drop", (event) => {
      if (dragging === null) return;
      event.preventDefault();
      column.classList.remove("is-over");
      const id = dragging;
      const index = indexAt(lists[name], event.clientY);
      dragging = null;
      moveTo(id, name, index);
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (title === "") return;
    try {
      const result = await FresnelBridge.call("add", { title });
      if (result.ok) {
        input.value = "";
        render(result.cards);
        status.textContent = "";
      } else {
        status.textContent = "추가하지 못했어요(" + textOf(result.reason) + ")";
      }
    } catch (error) {
      status.textContent = "추가하지 못했어요(" + reasonOf(error) + ")";
    }
  });

  FresnelBridge.onInvalidate(refresh);
  refresh();
})();
