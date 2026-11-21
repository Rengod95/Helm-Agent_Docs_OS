# Data layout

Replace `<data>`, `<config>`, `<state>`, and `<runtime>` with the folders in SKILL.md. `<project>` is the conversation's working folder (set with `-C <dir>` in the CLI).

## 1. Folder rules

- Base folders are created with mode `0700`. Startup fails if a base folder is owned by another user, has group or other permission bits (`permission_too_open`), or lacks owner write and execute (`permission_too_narrow`). Fix: `chmod 700 <folder>`.
- On WSL, `data`, `state`, `cache`, and `runtime` under `/mnt/` are refused (`data_dir_on_drvfs`). `config` under `/mnt/` works and logs a warning.
- The database is refused on network filesystems (SMB, NFS, AFP) and on WSL `/mnt/` drives (`unsupported_filesystem`).
- `FRESNEL_HOME` must be an absolute path (`not_absolute`). The managed setting `l0.os.dirs.override` is not applied by the host. `FRESNEL_HOME` is the only override.
- Socket path limit: the runtime path plus 24 bytes must fit in 100 bytes (macOS) or 104 bytes (Linux). Otherwise Fresnel uses `/tmp/fresnel-<uid>`.
- Temp files: `<system temp>/fresnel-<uid>` on macOS and Linux, `%TEMP%\fresnel` on Windows.
- Resource folder (read only): the folder that holds the executable. Bundled default plugins are in `<resource>/default-plugins/`.

## 2. Data folder

| Path | Content |
|---|---|
| `fresnel.db`, `-wal`, `-shm` | Conversation store. See section 3. |
| `blobs/<ab>/<rest>` | Large values as files. The file name is the SHA-256 of the content: the first 2 hex characters are the folder. `blobs/tmp/` holds files being written. |
| `backups/fresnel.db.pre-<UTC>-<owner>-v<from>-to-v<to>.sqlite` | Copy made before a schema migration of an existing database. The newest 3 are kept. |
| `restore-previous/<UTC>/` | Database files moved aside by `fresnel db restore`. |
| `measure.db`, `-wal`, `-shm` | Timing and usage per turn. Written while `x.operations.trace.enabled` is on (default on). Raw rows are kept `x.operations.trace.retentionDays` days (default 30). Request bodies are stored only when `x.operations.trace.storeRequestBody` is on (default off). No CLI command or model tool reads it. |
| `memory/USER.md` | Memory about the user. |
| `memory/MEMORY.md` | Memory about the environment. |
| `memory/.bak/<file>.<UTC>` | Copy kept when a memory file was changed outside Fresnel in a way that cannot be parsed. Fresnel cannot read its entries until the file is repaired. |
| `skills/<name>/SKILL.md` | User skills. Archived skills go to `skills/.archive/<name>-<UTC>/`. |

## 3. Conversation database

- Path: `<data>/fresnel.db`. SQLite in WAL mode. Each owner's tables carry a prefix.
- Event log (append-only): `events`, `event_seq`, `requests`, `thread_creation_keys`, `thread_delete_guard`, `projector_state`, `consumer_cursors`.
- Projections (rebuilt from events): `p_threads`, `p_turns`, `p_items`, `p_inputs`, `p_approvals`, `p_agents`, `p_effects`, `p_blob_refs`, `step_checkpoints`.
- `p_threads.running_since` is set when a turn commits its start and cleared when it completes. A value left behind after a crash marks an interrupted turn. `resume_attempts` counts resumes.
- Store bookkeeping: `sys_meta`, `sys_migrations` (schema steps applied per owner), `sys_migration_cursors`, `sys_prefixes`, `sys_leases`, `sys_blobs`, `sys_blob_refs`.
- Feature tables: `cap_knowledge_*` (skills, files, change ledger, proposals, search index), `cap_work_*`, `cap_web_*`, `cap_mcp_servers`, `x_learning_*`.
- Extension tables: `x_<id>_<table>`, where hyphens in the extension id become `_`.
- Migrations run at open, owner by owner. Before an existing database is upgraded, a copy goes to `backups/` (section 2).
- Database from a newer build: refused (`future_version`). Stored data that does not match the schema: `store.corrupt`.
- Interrupted restore: a file named `fresnel.db.restore-journal` or `fresnel.db.restore-staging` next to `fresnel.db` means a restore stopped. Run `fresnel db restore <folder>` again before starting Fresnel.
- Read conversations with `knowledge_search`, `session_read`, `session_scroll`, or `fresnel sessions show <id>` first. If raw rows are needed, open the file read-only (for example `sqlite3 -readonly <data>/fresnel.db`). Never write to it.

## 4. Session index

- Tables: `cap_knowledge_sessions` (one row per conversation: kind `main`, `subagent`, `background`, or `cron`; title; message count), `cap_knowledge_sessiondocs` (one row per user or assistant message), `cap_knowledge_sessionfts` (full text of messages), `cap_knowledge_sessioncursor` (how far the index has read the event log).
- Skill and memory text is indexed in `cap_knowledge_docsfts`.
- Full text uses FTS5 with the trigram tokenizer. Without FTS5, search falls back to LIKE, and `knowledge_search` returns `degraded` with the kinds it skipped. `l0.store.requireFts5` (default false) makes a missing FTS5 fail the database open (`fts5_missing`).
- Queries under 3 characters always use LIKE. `knowledge_search` returns `path` as `fts` or `like`.

## 5. Copies and sizes

- `fresnel db export <dir> --yes` writes `fresnel.sqlite` (a consistent copy), `blobs/`, and `manifest.json` into an empty folder. The command warns that the copy may contain secret values in plain text. Treat it as sensitive.
- `fresnel db usage` prints file sizes for the database, blobs, backups, logs, and restore folders. It starts no engine and writes nothing.

## 6. Settings

- User file: `<config>/settings.json`, one flat JSON object of key and value. `fresnel config set <key> <value>` writes it (default scope `user`).
- Project files: `<project>/.fresnel/settings.json` and `settings.local.json`. They are read only for trusted folders (decisions are in `<config>/trust.json`). `config set --scope project` or `--scope local` writes them.
- `config set` refuses the `managed` and `launch` scopes.
- Key names are layer, domain, and name, for example `l0.os.log.level`, `l0.store.blobGcEnabled`, `l0.process.service.enabled`, `l2.knowledge.skills.paths`, `x.operations.safeMode.default`, `l3.authoring.devMode`, and `ext.<name>.*` for extensions.
- Apply times: `live` takes effect on the next use. `nextTurn` applies from the next turn. `restart` needs a restart. Examples: `l0.os.log.level` is live; `x.operations.safeMode.default` and `l0.process.service.enabled` need a restart.
- Error kinds: `settings.unknownKey` (key not defined), `settings.invalidValue` (wrong type or range), `settings.secretValue` (a secret typed as a plain value). For a secret, run `fresnel secret add <name>` and write `secret://<name>` as the value.
- An unreadable settings file has its values treated as empty. `doctor` and `config` report the problem and do not show the file's values.

## 7. Secrets

- Values: encrypted with `sops` (age) in `<config>/secrets/sops/user.yaml`, the default file. `l0.secrets.sops.files` can list other files. `sops` 3.10.0 or newer is required. `age` is needed to create a key file.
- Metadata (name, description, scope, expiry, use policy): `<config>/secrets/meta/`.
- The age key decrypts the values. Where it is stored:
  - macOS: Keychain generic password, service `fresnel.age`, account `default`.
  - Linux: Secret Service through `secret-tool`, same service and account.
  - Key file (the fallback provider): `<config>/secrets/age/keys.txt`. The mode must be 0600 and the owner must be you. Otherwise the provider reports `file_mode`.
  - Windows: no keychain integration is built. Use the key file.
  - Public recipient: `<config>/secrets/age/recipient.<keyId>.txt`.
- Check the active provider with `fresnel secret key status`. Switch with `fresnel secret key use keychain` or `fresnel secret key use file`.
- If the key is lost, registered secrets cannot be decrypted. `doctor` reports "secrets are registered but the key is missing".
- Audit: `<config>/secrets/audit.log`, one JSON object per line, append-only. Records never contain values, fragments, or hashes. Retention is 90 days by default.
- `fresnel secret ls --json` returns name, status (`valid`, `expiring`, `expired`, `missing`, or `orphaned`), `meta`, and `lastUsedAt`. There is no value field.
- `fresnel secret test <name>` reports whether the value decrypts, its length, and the first 8 characters of its SHA-256. Do not paste this output into reports.
- Never run `fresnel secret reveal` during diagnosis.

## 8. Skills, memory, extensions

- Skill roots, in load order. When two skills have the same name, the first one loaded is kept and a `collision` diagnostic is recorded.
  1. `<project>/.fresnel/skills/` (trusted folders only)
  2. `<data>/skills/` (user)
  3. Roots supplied by extensions (read only)
  4. Folders listed in `l2.knowledge.skills.paths` (read only)
- A skill is a folder with `SKILL.md`. Its frontmatter gives `name` and `description`. Supporting files sit beside it.
- Memory: `<data>/memory/USER.md` and `MEMORY.md`. Edits made outside Fresnel are recorded as external changes.
- Extensions: an installed extension is a folder `<config>/extensions/<name>/` with its manifest at `.fresnel-plugin/plugin.json`. Project-level extensions are in `<project>/.fresnel/extensions/<name>/` and load only for trusted folders.
- `fresnel author ls --json` lists the user-installed extensions with their status and location.
