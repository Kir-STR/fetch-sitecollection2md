# Инструкции для AI-агента — роль: оператор

## Дисциплина

Правила проекта живут в `.claude/rules/*.md` (с frontmatter `globs`/`class`). Ниже — карта активных модулей.

- **Operator gate** — подтверждай деструктивные/наружу-направленные действия. См. `.claude/rules/operator-gate.md`.
- **Secret hygiene** — не выводить секреты целиком, маскировать значения. См. `.claude/rules/secret-hygiene.md`.
- **Worktree workflow** — изоляция работы в git worktrees. См. `.claude/rules/worktree-workflow.md`.
- **Architectural invariants** — границы слоёв и модулей проекта. См. `.claude/rules/architectural-invariants.md`.
- **Glossary** — канон терминов. См. `.claude/rules/glossary.md`.
