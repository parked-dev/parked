# Docs

Three kinds of document, deliberately separate:

| File | Answers | Changes when |
|---|---|---|
| [requirements/functional.md](requirements/functional.md) | What can a user do? | A capability is added, removed or redefined |
| [requirements/non-functional.md](requirements/non-functional.md) | What must stay true? | A quality bar, constraint or supported platform changes |
| [architecture.md](architecture.md) | How is it built today? | Modules, storage, transports or controls change |

[AGENTS.md](../AGENTS.md) holds the working rules: how to test, what may not be weakened, and what CI expects.

## Conventions

- **Requirement IDs are permanent.** `FR-3` never gets reused for something else. If a requirement is dropped, mark it withdrawn rather than deleting the number.
- **Requirements describe observable behaviour**, not mechanisms. "The user can resume in one action" is a requirement; "Resume runs `opencode -s <id>`" is architecture.
- **Every requirement states how it is verified**, either a test file or a manual check. If it can't be verified, it is an aspiration, not a requirement.
- **Cite IDs** in pull requests and tests, so a change can be traced back to what it was meant to do.

## Keeping them honest

When behaviour changes, update the requirement in the same pull request. A requirement that no longer matches the code is worse than no requirement: agents and contributors will follow it and be wrong.
