// L2.work.spec §3.8. 투영기 cap.work의 작업·계획·목표·보고 부분.
// 버전 2: cap_work_plans와 cap_work_meta의 권한 모드 추적 열(mode, mode_before_plan, plan_entered_seq)을 더했다.
// 버전 3: 목표(cap_work_goals, cap_work_judgments)와 보고(cap_work_reports) 테이블을 더했다(M3-REQ-90).

export const WORK_PROJECTOR_NAME = "cap.work";
export const WORK_PROJECTOR_VERSION = 3;

export const WORK_PROJECTOR_TABLES: readonly string[] = [
  "cap_work_tasks",
  "cap_work_edges",
  "cap_work_plans",
  "cap_work_meta",
  "cap_work_goals",
  "cap_work_judgments",
  "cap_work_reports",
];

export const WORK_PROJECTOR_DDL: readonly string[] = [
  `CREATE TABLE cap_work_tasks (
  session_id   TEXT NOT NULL,
  task_id      TEXT NOT NULL,
  ord          INTEGER NOT NULL,
  content      TEXT NOT NULL,
  active_form  TEXT,
  status       TEXT NOT NULL,
  owner        TEXT,
  created_seq  INTEGER NOT NULL,
  updated_seq  INTEGER NOT NULL,
  PRIMARY KEY (session_id, task_id)
) STRICT`,
  `CREATE TABLE cap_work_edges (
  session_id   TEXT NOT NULL,
  task_id      TEXT NOT NULL,
  blocked_by   TEXT NOT NULL,
  PRIMARY KEY (session_id, task_id, blocked_by)
) STRICT`,
  `CREATE TABLE cap_work_plans (
  session_id   TEXT NOT NULL,
  plan_id      TEXT NOT NULL,
  version      INTEGER NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL,
  artifact     TEXT,
  approval_id  TEXT,
  feedback     TEXT,
  submitted_seq INTEGER NOT NULL,
  decided_seq  INTEGER,
  PRIMARY KEY (session_id, plan_id, version)
) STRICT`,
  // 승인 요청은 요청한 대화(origin.threadId)와 기록한 대화(surfaceThreadId)가 다를 수 있어 승인 id만으로 찾는다
  `CREATE INDEX cap_work_plans_approval ON cap_work_plans (approval_id)`,
  `CREATE TABLE cap_work_meta (
  session_id   TEXT NOT NULL PRIMARY KEY,
  turns_completed INTEGER NOT NULL,
  last_task_change_turn INTEGER NOT NULL,
  mode         TEXT,
  mode_before_plan TEXT,
  plan_entered_seq INTEGER
) STRICT`,
  // goal은 Goal JSON(최신). set_at은 work.goal_set의 recordedAt이고 보고의 durationMs 기준이다(spec §3.8에 없던 열)
  `CREATE TABLE cap_work_goals (
  session_id   TEXT NOT NULL,
  goal_id      TEXT NOT NULL,
  ord          INTEGER NOT NULL,
  goal         TEXT NOT NULL,
  status       TEXT NOT NULL,
  set_seq      INTEGER NOT NULL,
  set_at       INTEGER NOT NULL,
  settled_seq  INTEGER,
  PRIMARY KEY (session_id, goal_id)
) STRICT`,
  // 한 turn 안에서 완료 게이트가 판정을 여러 번 할 수 있어 spec §3.8의 UNIQUE(goal_id, turn_id)를 두지 않는다
  `CREATE TABLE cap_work_judgments (
  session_id   TEXT NOT NULL,
  goal_id      TEXT NOT NULL,
  n            INTEGER NOT NULL,
  turn_id      TEXT NOT NULL,
  judgment     TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  PRIMARY KEY (session_id, goal_id, n)
) STRICT`,
  `CREATE TABLE cap_work_reports (
  session_id   TEXT NOT NULL,
  report_id    TEXT NOT NULL,
  ord          INTEGER NOT NULL,
  report       TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  PRIMARY KEY (session_id, report_id)
) STRICT`,
];
