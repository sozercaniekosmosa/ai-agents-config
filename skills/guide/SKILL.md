---
name: guide
description: Update plugin guide.md with latest architecture, features, and gotchas.
argument-hint: "Target plugin name or path"
disable-model-invocation: true
---

Analyze conversation context and update or create `guide.md` in the target plugin/module directory (`[plugins-root]/[plugin-name]/guide.md`).

> [!IMPORTANT]
> **NO CONVERSATION FILES:** Do NOT create files in `.conversation/` or session log files (`[prefix]-XX-...md`).
> All plugin specifications, architecture maps, feature statuses, and architectural constraints must live directly inside `[plugins-root]/[plugin-name]/guide.md`.
> **ENGLISH ONLY:** All `guide.md` files MUST be created and updated strictly in English to minimize token consumption.

## Structure of `guide.md`

```markdown
# Plugin Specification: [Plugin Name]

> [!IMPORTANT]
> **CRITICAL AI DIRECTIVE / КРИТИЧЕСКАЯ ДИРЕКТИВА ИИ:**
> - **EN**: This file is strictly for **storing static context and architecture reference** of the plugin. It is **NOT** a guide to action, a task checklist, a development plan, or instructions to execute. Do **NOT** attempt to implement, modify, test, or run anything described in this file unless explicitly requested by the user. If this file is referenced in the chat prefix with two minuses (`-- [path]/guide.md`), the entire plugin is STRICTLY FORBIDDEN from being modified.
> - **RU**: Этот файл предназначен исключительно для **хранения статического контекста и описания архитектуры** плагина. Он **НЕ** является руководством к действию, списком задач, планом или инструкцией для выполнения. **ЗАПРЕЩЕНО** пытаться реализовывать, изменять, тестировать или запускать что-либо из описанного в этом файле без явного указания пользователя. Если на этот файл гайда ссылаются в чате с префиксом из двух минусов (`-- [path]/guide.md`), данный плагин СТРОГО ЗАПРЕЩЕНО изменять.

## File Architecture Map (`architecture_map`)
- `file.tsx` - [Responsibility description and key exports]

## Feature Status (`feature_status`)
- Feature A: [Active / In Progress / Deprecated status]

## Plugin Capabilities & Contracts (`plugin_capabilities_and_contracts`)
- **CONTRACT_SPEC**: [If runtime contract validation is used, document the complete `CONTRACT_SPEC` object freeze structure with api methods, arguments, and return types]
- **Implemented Adapters (Capabilities)**:
  - `get[AdapterName]Adapter` - [E.g., GeometryAdapter, ColorAdapter, AutokeyAdapter. Detail its methods, constraints, and runtime validation behavior]

## Architectural Constraints & Rules (`architecture_and_constraints`)
- **Rule 1**: [Constraint description, capability contract, or gotcha]
```

## Rules & Workflow

1. **Language & Token Optimization**:
   - Write `guide.md` **exclusively in English** to reduce token usage and improve context density.

2. **Path Scoping & Safety**:
   - Locate the target plugin directory strictly under `[plugins-root]/[plugin-name]/`.
   - Prevent path traversal outside the plugin base directory.

2. **Context Inspection & Incremental Merge**:
   - Read existing `guide.md` if present before modifying.
   - Preserve valid existing architecture entries, feature statuses, and architectural rules.
   - Prune entries for files or features that no longer exist in the workspace.
   - Append new findings, capabilities, or gotchas discovered in the current task.

3. **Link Format & Integrity**:
   - Use relative paths (e.g., `index.tsx`, `store/domain-store.ts`) or workspace-relative paths for file references within the guide.
   - Do NOT use absolute file links with the `file:///` scheme (e.g., `file:///d:/...`) inside `guide.md` to avoid verbosity and save tokens.
   - Ensure all referenced file paths exist in the workspace.

4. **Formatting & Compression**:
   - Keep `guide.md` clean, dense, and structured in technical Caveman style.
   - Exclude temporary session step logs, git diffs, or transcript history.

5. **Structural & Content Audit (Zero Dead Info)**:
   - Perform a rigorous full-file audit during every update. Do not just append new notes.
   - Cross-reference every listed file, feature, constant, hotkey, and constraint in the guide with the actual codebase.
   - Proactively remove or update any dead, outdated, or inaccurate information (e.g. references to deleted files, deprecated components, changed hotkeys, or old state structures).
   - Ensure perfect structural sorting: map files to `architecture_map`, feature lists to `feature_status`, APIs and adapters to `plugin_capabilities_and_contracts`, and general gotchas/rules to `architecture_and_constraints`. Eliminate all duplicates.

## Scripts & Utilities

- **Guide Merge Utility**: `.agents/skills/guide/scripts/merge-guides.cjs`
  - Automated tool to merge architecture maps, feature statuses, and session records without duplicates.
  - Can be invoked via CLI: `node .agents/skills/guide/scripts/merge-guides.cjs [target.md] [source.md]`.
