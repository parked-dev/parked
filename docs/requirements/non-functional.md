# Non-functional requirements

Qualities the product must keep, whatever the implementation. Each states a property, not a mechanism;
[architecture.md](../architecture.md) describes how it is met today.

---

## NFR-1 Locally contained

Parked work is private to the machine it was created on.

- Nothing is sent anywhere except the tools the app already uses locally (`gh`, `git`, `npm`).
- No telemetry, analytics, crash reporting or "phone home".
- The dashboard is reachable only from the machine it runs on.
- Apart from those tool calls, it works offline.

**Verified by:** review of outbound calls; the dashboard refuses non-loopback hosts.

---

## NFR-2 Safe by default

No other website can read or change the user's parked work, and nothing that arrives from outside the
app is ever executed.

- A page the user happens to have open cannot silently read items or trigger Resume or Dismiss.
- Data written by an agent is treated as untrusted input when displayed.
- The app never runs a command assembled from stored or requested text.
- It holds no standing credentials; it borrows `gh`'s and the user's terminal access.

**Verified by:** `parked.test.js` (`web:` tests for token, Origin and Host rejection; `resume:` tests for
session-id validation).

---

## NFR-3 Durable

Parked work survives restarts, reboots and updates.

- A crash or a restart never loses recorded work.
- The database from an earlier version must keep opening after an upgrade.
- Downgrades are not supported: schema changes are forward-only.
- Dismissing is the only way work disappears.

**Verified by:** `parked.test.js` (legacy-schema test, restart behaviour in the browser run).

---

## NFR-4 Predictable operation

Install, update and remove are reversible and do not surprise the user.

- Every operation that changes the user's machine reports what it changed.
- Repeating an operation is safe and idempotent.
- Removing the app never deletes stored work implicitly.
- A port conflict or missing prerequisite fails with an actionable message, not a stack trace.

**Verified by:** `install.test.js`.

---

## NFR-5 Accessible

Usable without a mouse, readable by default.

- Every action is reachable by keyboard, with a visible focus state.
- Text meets WCAG AA contrast in both light and dark themes.
- The interface follows the system light/dark preference rather than forcing one.
- Status is not conveyed by colour alone (labels accompany the coloured accents).

**Verified by:** manual keyboard pass; contrast and theme check.

---

## NFR-6 Maintainable

A single maintainer can understand and change the project without fear.

- The backend uses only the Node standard library at runtime.
- Modules have one job each, with boundaries documented in the architecture.
- Behaviour is covered by tests using `node:test`; no additional test framework.
- Requirements and code move together.

**Verified by:** dependency review; test coverage of each requirement.

---

## NFR-7 Supply-chain aware

Nothing enters the build or CI unreviewed.

- GitHub Actions are pinned to full commit SHAs, with the version in a comment.
- Dependency lockfiles are committed; UI dependencies are deliberately few.
- A new runtime dependency needs a justification in the pull request.

**Verified by:** CI workflow review; `npm ls --omit=dev` at the repository root.

---

## NFR-8 Responsive

The dashboard feels immediate on a laptop.

- The first useful paint is under 2 seconds on a warm local machine.
- Local API responses complete in well under 50 ms.
- The list stays smooth with at least 200 items: sorting and expanding do not cause a noticeable pause.
- Polling is cheap: the browser polls only while the tab is visible, and GitHub is checked at most every two minutes per item.
- The shipped UI bundle stays at or below 150 KB gzipped; it is currently around 98 KB.

**Verified by:** build output size; manual timing.
