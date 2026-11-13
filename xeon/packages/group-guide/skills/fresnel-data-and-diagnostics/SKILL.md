---
name: fresnel-data-and-diagnostics
description: Use when the user asks where Fresnel keeps its data, logs, settings, secrets, skills or memory, or when Fresnel fails to start or misbehaves.
---

# Fresnel data and diagnostics

Use this to find Fresnel's files and to check a problem. Load a reference only when you need its details, with `skill_view` and `file` set to a path below.

| File | Read it for |
|---|---|
| `references/data-layout.md` | Folders, database tables, settings, secrets, skills, memory, extensions, search index |
| `references/diagnosis.md` | Logs and events, CLI diagnostic commands, startup failures, safe mode, session tools, extension health, dev mode, reporting |

## Where things are

`FRESNEL_HOME=<absolute path>` replaces the base folders with `<FRESNEL_HOME>/data`, `config`, `state`, `cache`, and `run`.

| Folder | macOS | Linux (WSL too) | Windows |
|---|---|---|---|
| data | `~/Library/Application Support/fresnel` | `$XDG_DATA_HOME/fresnel` (default `~/.local/share/fresnel`) | `%LOCALAPPDATA%\fresnel\data` |
| config | `~/Library/Application Support/fresnel/config` | `$XDG_CONFIG_HOME/fresnel` (default `~/.config/fresnel`) | `%APPDATA%\fresnel` |
| state | `~/Library/Application Support/fresnel/state` | `$XDG_STATE_HOME/fresnel` (default `~/.local/state/fresnel`) | `%LOCALAPPDATA%\fresnel\state` |
| cache | `~/Library/Caches/fresnel` | `$XDG_CACHE_HOME/fresnel` (default `~/.cache/fresnel`) | `%LOCALAPPDATA%\fresnel\cache` |
| runtime | `$TMPDIR/fresnel`, else `/tmp/fresnel-<uid>` | `$XDG_RUNTIME_DIR/fresnel`, else `/tmp/fresnel-<uid>` | `%LOCALAPPDATA%\fresnel\run` |

| What | Path |
|---|---|
| Conversation database | `data/fresnel.db` (with `-wal` and `-shm`) |
| Large attachments | `data/blobs/<2 hex>/<rest>` |
| Engine log | `state/logs/<mode>.log` |
| User settings | `config/settings.json` |
| Project settings | `<project>/.fresnel/settings.json`, `settings.local.json` (trusted folders only) |
| Project trust decisions | `config/trust.json` |
| Secrets | `config/secrets/` (encrypted values, metadata, key file, audit log) |
| User skills | `data/skills/<name>/SKILL.md` |
| Project skills | `<project>/.fresnel/skills/<name>/SKILL.md` (trusted folders only) |
| Memory | `data/memory/USER.md`, `data/memory/MEMORY.md` |
| Installed extensions | `config/extensions/<name>/`, `<project>/.fresnel/extensions/<name>/` (trusted folders only) |
| Search index | `cap_knowledge_*` tables inside `fresnel.db` |
| Service socket and registration | `runtime/fresnel.sock`, `runtime/service.json` (holds a token, mode 0600) |

Never print, paste, or send secret values, the service token, or the contents of the key file.

## Diagnosis checklist

1. Get the facts first: OS, how Fresnel runs (chat, background service, or desktop app), the exact error text, and the exit code.
2. Run `fresnel doctor` (add `--json` for every check). Exit 3 means an environment problem, such as a missing required binary or a missing secret key.
3. Read the newest log lines with `tail -n 200 <state>/logs/<mode>.log`. Look for `"level":"error"` and `"level":"warn"`.
4. Startup exits with 3, or with 70 to 76 from `host --stdio`: check the data folder permissions, whether another program holds the database, and disk space. See `diagnosis.md` section 4.
5. Startup keeps failing: read `state/startup-health.json`. At 3 consecutive failures, start with `fresnel chat --safe-mode`.
6. An extension misbehaves: `fresnel author ls --json` shows its status. Search the log for `handler failed:`.
7. A setting has no effect: `fresnel config get <key>`. `doctor` reports a settings file it could not read.
8. A past conversation is needed: `knowledge_search` with `kinds: ["session"]`, then `session_scroll` around the hit's `seq`.
9. Before sharing anything with the user or in a report, follow `diagnosis.md` section 9.
