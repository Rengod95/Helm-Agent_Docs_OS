// L2.work.spec §3.8. 투영기 cap.work의 작업 부분. 계획·목표·보고 테이블은 해당 작업(WK.2~)이 더하며 투영 버전을 올린다.

export const WORK_PROJECTOR_NAME = "cap.work";
export const WORK_PROJECTOR_VERSION = 1;

export const WORK_PROJECTOR_TABLES: readonly string[] = [
  "cap_work_tasks",
  "cap_work_task_edges",
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
  `CREATE TABLE cap_work_meta (
  session_id   TEXT NOT NULL PRIMARY KEY,
  turns_completed INTEGER NOT NULL,
  last_task_change_turn INTEGER NOT NULL
) STRICT`,
];
