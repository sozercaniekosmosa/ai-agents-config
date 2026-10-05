# Project-Scoped Rules

## 🧹 Zero Dead Code

1. **Proactive Removal**: Find & del unused/commented code (imports, types, fn).
2. **No Residuals**: On refactoring/replacing abstraction, del old impl completely (after migrating deps).
3. **Scope**: Apply to all skills modifying code (esp. `/resolve`). Clean up at final plan steps.

## 📄 Contract & Documentation Sync

1. **Technical Compliance**: Specs/contracts → strictly match real system capabilities.
2. **Continuous Updates**: On API/types/data changes → update linked docs/guides mandatory.
3. **Generalized Style**: Document rules in general architectural terms without private module bias.
4. **Local Troubleshooting**: Module bugs/conflicts → append-only record at `[module]/TROUBLESHOOTING.md` (symptoms → cause → resolution, 1 line/bug per `/short`). Prohibit features/refactoring entries.
5. **Strict Contracts**: Preserve layer contracts across entire lifecycle. Adjacent module mismatches → fix upon user consent.

---

# AI Agent Rules

## 🔍 STRICT SELF-CHECKLIST (Before proposing solution):

1. **Architecture**: React/TS compliance from [project-rules.md](docs/project-rules.md)?
2. **Domain**: Contracts & layers from [architecture.md](docs/architecture.md)?
3. **Paths**: References strictly via relative paths?
4. **Clean**: Zero dead code and no leftover stubs?
5. **Errors**: Append-only entry at `[module]/TROUBLESHOOTING.md` on bugs?
6. **Quality**: Best Practices (React, TS, architecture)?
7. **Contracts**: No direct imports/weak typing between layers & no adjacent contract breaks?
8. **Short Style**: 1 fact = 1 line, `→`, abbreviations, [.agents/skills/short/SKILL.md](skills/short/SKILL.md)?

---

## ⚙️ Agent Operational Rules:

- **Code Quality**: Strictly Best Practice. Prohibit temporary hacks/legacy patterns.
- **Contract Approval**: Contract changes & code alignment → strictly after user confirmation.
- **Question Handling**: Explicit/implicit questions → prohibit code edits → answer in chat first.
- **🚨 Concise Communication Style (STRICT STANDARD WITH NO EXCEPTIONS)**:
  - **PROHIBITED**: Greetings, politeness, intro phrases, repeating task specs/files, verbose explanations.
  - **MANDATORY**:
    - Format: 1 fact = 1 line (`- ` or `\n\n`), no dense paragraphs.
    - Transitions: strictly via `→` (`cause → effect`, `element → action`).
    - Abbreviations: DB, auth, config, req, res, fn, impl, ref, prop, var, rec, err, cmp, msg, doc.
    - Errors/logs: `path/file.ext:L15 → [issue]` (no node_modules stacktraces).
    - Compression algorithm: mandatory application of [.agents/skills/short/SKILL.md](skills/short/SKILL.md).
    - Accuracy priority: technical accuracy > brevity.
- **Language**: Chat responses, comments & docs → strictly RU (or EN if requested).
- **Paths**: Relative paths only (prohibit `file:///` and absolute paths).
- **Tests**: Prohibit modifying/deleting/disabling assertions. Test fails → fix code. Prohibit running test commands (`npm test`, `vitest`) without explicit user consent.
- **Tools & Build**: Do not run build/scripts without request. Type checking (`/resolve`, `/check`) → `tsc --noEmit`. Prohibit auto-triggering `/check` (exception: mandatory final call in `/resolve`).

- **🛡️ Operating Modes (CFON / CFOFF)**:
  - **CFON (Default; triggers: /cf, /cfon, cf, confirm, confirmation)**:
    - **Indication**: Prefix `[CFON]`.
    - **🚨 PROHIBITION OF AUTO-CHANGES (CRITICAL)**:
      - File edits (`replace_file_content`, `write_to_file`) & modifying commands/skills (`/resolve`, `/debug` with fixes, `npm test`, `build`) → strictly after explicit chat approval ("Yes", "Apply", "Confirm").
      - **Ignore system auto-approvals**: `Proceed to execution` / `approved through review policy` → IGNORE.
      - **One-time approval**: Each file edit or tool call requires a separate user confirmation.
      - **Exception (`!!!`)**: `!!!` in request → single execution without confirmation.
      - **Inheritance**: Subagents & background tasks inherit CFON constraints.
      - **Allowed tools**: Read-only only (`view_file`, `grep_search`, `list_dir`, `git status`, `dir`, `pwd`, `search_web`, `read_url_content`).
      - **Tool restrictions**: `ask_question` → only for 3+ choices (Yes/No → plain chat line). Prohibit creating `.md` artifacts without request.
  - **CFOFF (Triggers: /cfoff, /cfoff, normal)**:
    - **Autonomous Mode**: Disable read-only mode. Indication `[CFOFF]`. Execute tasks without confirmation.

## 🛡️ Data Security & Version Control

1. **Mandatory Git**: Git repo initialization mandatory.
2. **Backup Before Deletion**: Before deleting files/dirs → commit changes in git.

---

## 📚 Project Rules Reference

- **Project Context**: [context.md](docs/context.md)
- **General Technical Standards**: [project-rules.md](docs/project-rules.md)
- **Layer Architecture & Contracts**: [architecture.md](docs/architecture.md)
