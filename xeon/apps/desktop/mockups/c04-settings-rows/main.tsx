// P-09 설정 보탬 행 목업 진입점(p09-settings 모양, 공용 틀 _settings). ?state=<id>(기본 plugins), ?scenario=<id>[&step=n][&hold=1], ?theme=dark, ?dev=1.
import "./mockup.css";
import { mountSettingsPage } from "../_settings/mount";
import { App, STATES } from "./app";

mountSettingsPage(STATES, (state) => <App key={state} state={state} />);
