// 예제 확장 viewdemo의 진입점. 화면(ui)만 보이는 확장이라 훅은 아무 일도 하지 않는다.
export const extension = ({ register }) => {
  register("viewdemo", {}, (g) => {
    g.on("boundary.settle.after", () => {});
  });
};
