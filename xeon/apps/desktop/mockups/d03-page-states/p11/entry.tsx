// d03: 원래 페이지의 App을 그대로 감싼다(설정 틀은 mountSettingsPage와 같은 ShellStateProvider).
import { ShellStateProvider } from "../../_shell";
import { App, STATES } from "./app";

export { STATES };

export function Root({ state }: { state: string }) {
  return (
    <ShellStateProvider>
      <App state={state as (typeof STATES)[number]["id"]} />
    </ShellStateProvider>
  );
}
