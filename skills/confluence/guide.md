# Module Specification: Confluence Integration Skill

> [!IMPORTANT]
> **CRITICAL AI DIRECTIVE / КРИТИЧЕСКАЯ ДИРЕКТИВА ИИ:**
> - **EN**: This file is strictly for **storing static context and architecture reference** of the module. It is **NOT** a guide to action, a task checklist, a development plan, or instructions to execute. Do **NOT** attempt to implement, modify, test, or run anything described in this file unless explicitly requested by the user. If this file is referenced in the chat prefix with two minuses (`-- [path]/guide.md`), the entire module is STRICTLY FORBIDDEN from being modified.
> - **RU**: Этот файл предназначен исключительно для **хранения статического контекста и описания архитектуры** модуля. Он **НЕ** является руководством к действию, списком задач, планом или инструкцией для выполнения. **ЗАПРЕЩЕНО** пытаться реализовывать, изменять, тестировать или запускать что-либо из описанного в этом файле без явного указания пользователя. Если на этот файл гайда ссылаются в чате с префиксом из двух минусов (`-- [path]/guide.md`), данный модуль СТРОГО ЗАПРЕЩЕНО изменять.

## File Architecture Map (`architecture_map`)
- `scripts/serve_ui.cjs` - Local Node.js HTTP server. Serves API endpoints (`/api/tree`, `/api/page`, `/api/history`, `/api/diff`, `/api/diff_rendered`, `/api/patch/*`, `/api/sync_server`, `/api/search`) and static UI without caching.
- `scripts/storage.cjs` - Handles local storage operations. Manages `local_patches` and `server_history` (`vendor/diff.cjs`). Provides unified patch log, rollback, diffing, reverse patch reconstruction, and merging.
- `scripts/sync_all.cjs` - Fetches the latest pages from Confluence server via API and syncs them into local storage (creates `server_history` patches on change).
- `scripts/push_page.cjs` - Pushes selected local document state to Confluence API.
- `storage/confluence_index.json` - Global metadata index (IDs, parent relationships, versions, commit heads).
- `storage/confluence_data.json` - Core data store. Contains `base` HTML, `local_patches`, and `server_history` for each page.
- `web-ui/viewer.html` - The frontend interface. Renders tree view, SPA hash routing, search, history dropdown (hides internal base-shift patches), Rendered HTML diff view as default, and patch deletion/pushing.
- `start_ui.bat` - Launch script for Windows to start the local UI server on port 8080.
- `package.json` - Integration config (npm scripts for start/sync/push).

## Feature Status (`feature_status`)
- Feature Local UI: Active
- Feature Remote Sync (Pull): Active
- Feature Unified Patch History: Active (hides technical `Pushed local changes` from UI dropdown)
- Feature Rendered HTML Diff: Active (Default view mode via `htmldiff.cjs`)
- Feature Push to Server: Active
- Feature Delete/Rollback Patch: Active (supports both local patch cascade rollback and server history deletion)
- Feature SPA Hash Routing: Active
- Feature Full-text Search: Active
- Feature Russian Localization: Active

## Module Capabilities & Contracts (`module_capabilities_and_contracts`)
- **API & Contracts**:
  - `GET /api/tree`: Returns `confluence_index.json` as JSON. Header: `Cache-Control: no-store`.
  - `GET /api/page?id={id}`: Returns page state with applied local patches and remote URL metadata.
  - `GET /api/history?id={id}`: Returns unified timeline of `server` and `local` patches.
  - `GET /api/diff?id={id}&commitId={commitId}`: Returns raw unified text diff for a specific patch.
  - `GET /api/diff_rendered?id={id}&commitId={commitId}`: Returns visual HTML diff rendered with `htmldiff.cjs`.
  - `GET /api/search?q={query}`: Searches titles and body content, returning matching snippets.
  - `POST /api/patch/delete`: Deletes a target patch (cascades for local patches, removes single entry for server history). Body: `{ pageId, commitId }`.
  - `POST /api/patch/push`: Reconstructs state at target commit and pushes to Confluence as new remote version. Body: `{ pageId, commitId }`.
  - `POST /api/sync_server`: Triggers `sync_all.cjs` to pull updates from Confluence.

## Architectural Constraints & Rules (`architecture_and_constraints`)
- **Rule 1**: Data isolation & diff chain integrity. `local_patches` holds unpushed user edits; `server_history` holds remote versions and base shifts (`Pushed local changes`). Technical base-shift entries maintain structural diff chain continuity but are excluded from the UI dropdown.
- **Rule 2**: Rollback integrity. Deleting a local patch prunes all subsequent local patches to prevent diff misalignment.
- **Rule 3**: Browser caching. The `serve_ui.cjs` API includes strict `Cache-Control: no-store` headers, and `fetch()` in frontend uses `{ cache: 'no-store' }`.
- **Rule 4**: Default diff visualization. The default diff view in UI is `Render` mode (using `htmldiff.cjs`), with code view available as a secondary toggle.
- **Rule 5**: Zero external DB. Storage is purely file-based (`.json`) utilizing `jsdiff` with `{ context: 0 }` for space-efficient patch storage.
