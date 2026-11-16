// L2.work.spec §3.8. 투영기 cap.work의 작업·목표·보고 부분.
// 버전 2: cap_work_plans와 cap_work_meta의 권한 모드 추적 열(mode, mode_before_plan, plan_entered_seq)을 더했다.
// 버전 3: 목표(cap_work_goals, cap_work_judgments)와 보고(cap_work_reports) 테이블을 더했다(M3-REQ-90).
// 버전 4: 계획 모드를 없앴다 [결정: 2026-11-13 사용자]. cap_work_meta의 권한 모드 추적 열을 뺐다. cap_work_plans는 옛 계획 기록을 읽기 위해 남긴다.
// 버전 5: 계획 기록 표 cap_work_plans와 그 인덱스를 지웠다 [결정: 2026-11-15 사용자]. 옛 work.plan_*와 계획 승인 기록은 투영기가 읽지 않는다.
//   옛 DB에 남은 표는 재구성 때 첫 문장의 DROP으로 지운다.

export const WORK_PROJECTOR_NAME = "cap.work";
export const WORK_PROJECTOR_VERSION = 5;

export const WORK_PROJECTOR_TABLES: readonly string[] = [
  "cap_work_tasks",
  "cap_work_edges",
  "cap_work_meta",
  "cap_work_goals",
  "cap_work_judgments",
  "cap_work_reports",
];

export const WORK_PROJECTOR_DDL: readonly string[] = [
  // 버전 4까지 있던 옛 표. 목록에 없어 재구성의 DROP은 이것을 치지 못하므로 여기서 지운다(없으면 아무 일도 없다)
  "DROP TABLE IF EXISTS cap_work_plans",
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
  `CREATE TABLE cap_work_meta (
  session_id   TEXT NOT NULL PRIMARY KEY,
  turns_completed INTEGER NOT NULL,
  last_task_change_turn INTEGER NOT NULL
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
