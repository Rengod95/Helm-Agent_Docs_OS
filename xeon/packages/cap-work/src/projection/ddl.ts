// L2.work.spec §3.8. 투영기 cap.work의 작업·계획 부분. 목표·보고 테이블은 해당 작업(T9~T12)이 더하며 투영 버전을 올린다.
// 버전 2: cap_work_plans와 cap_work_meta의 권한 모드 추적 열(mode, mode_before_plan, plan_entered_seq)을 더했다.

export const WORK_PROJECTOR_NAME = "cap.work";
export const WORK_PROJECTOR_VERSION = 2;

export const WORK_PROJECTOR_TABLES: readonly string[] = [
  "cap_work_tasks",
  "cap_work_task_edges",
  "cap_work_plans",
  "cap_work_meta",
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
  `CREATE TABLE cap_work_task_edges (
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
];
