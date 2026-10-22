# Functional requirements

What a user can do with parked. Each requirement is observable: you can tell whether it is met
without reading the source.

Scope for `0.1.x`: macOS, opencode, one user per machine. See [non-goals](#non-goals).

---

## FR-1 Capture paused work

When work stops because it depends on something outside the session, the user can record it in one
action: what is being waited on, what to do next, and enough context to pick the work back up without
reading the old conversation.

**Acceptance criteria**
- An agent can record an entry without leaving the session or filling in a form.
- An entry is refused, with a message the agent can act on, when the essentials are missing: what is awaited, the next steps, and the resume context.
- The user is told the entry was recorded; no item number is exposed, because it means nothing to them.

**Verified by:** `parked.test.js` (`mcp:` tests), manual check in a live session.

---

## FR-2 See what needs attention

The user can see, in one place, which parked work is actionable now and which is still waiting, across
all projects, without opening any session.

**Acceptance criteria**
- Work is separated into "Ready for you" and "Waiting on others", each with a count.
- Each item shows what is awaited, the project, the link when there is one, the next steps, and the resume context.
- A change recorded elsewhere appears within 10 seconds without a manual refresh.
- An empty dashboard explains itself rather than showing a blank page.

**Verified by:** manual check; `ui/src/lib/format.test.ts` for the text formatting rules.

---

## FR-3 Resume in one action

From an item, the user can reopen the paused session where it stopped.

**Acceptance criteria**
- One action opens a terminal window in the item's project on that session.
- When the exact session cannot be determined, it falls back to the most recent session in that project. It never opens a different project.
- A failure to open the terminal is surfaced in the dashboard, not swallowed.

**Verified by:** `parked.test.js` (`resume:` and `web:` tests); manual check with Ghostty and iTerm.

---

## FR-4 External dependencies resolve themselves

When the thing being waited on is a GitHub pull request, the app notices when it becomes actionable and
promotes the item, so the user does not poll GitHub by hand.

**Acceptance criteria**
- A pull request that is approved, merged, closed, or has changes requested moves its item to Ready.
- The move happens within a few minutes of the event, without user interaction.
- If GitHub cannot be reached, the item stays Waiting and shows that the last check failed; the dashboard keeps working.
- Waits that are not GitHub pull requests stay manual; the app does not pretend to watch them.

**Verified by:** `parked.test.js` (`poller:` tests).

---

## FR-5 Dismiss finished work

The user can mark an item done and it stops appearing.

**Acceptance criteria**
- The item disappears immediately and does not return on refresh.
- Finished items are not retained, so the app's storage does not grow with use.
- Dismissing cannot be triggered by another website (see NFR-2).

**Verified by:** `parked.test.js` (`web:` tests).

---

## FR-6 Adopt it in one sitting

A user can install the app, have it run without keeping a terminal open, update it, and remove it,
without editing configuration files by hand.

**Acceptance criteria**
- Installation is a small number of documented commands.
- Running it does not require the user to keep a terminal window open.
- Re-running the installer is safe and does not duplicate configuration.
- A dry run shows every change before anything is written.
- Removal stops any background process and leaves no scheduled job behind. Stored data is only deleted on explicit request.

**Verified by:** `install.test.js`; manual check of the login agent.

---

## FR-7 Share it with others

Anyone can install and use the app without needing a private checkout or asking the author for access.

**Acceptance criteria**
- The published instructions work from a clean machine with only the documented prerequisites.
- No private repository access, invitation or credential is required to install.
- The licence permits use, modification and redistribution.

**Verified by:** fresh clone and install on a machine with no prior copy.

---

## Non-goals

Explicitly out of scope. Adding any of these is a product decision, not an implementation detail:

- Hosting the dashboard as a service, or multi-user accounts.
- Windows and Linux support.
- Agent harnesses other than opencode.
- Terminals other than Ghostty and iTerm.
- Watching dependencies other than GitHub pull requests (deployments, health checks, tickets).
- Push notifications or a menu-bar presence.
- Retaining completed work as history or reporting.
