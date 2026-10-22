# Freeman Notes Project Philosophy

## Mission

Freeman Notes exists to provide a fast, self-hosted, offline-first note-taking experience that feels effortless to use while remaining powerful enough to serve as a long-term personal and collaborative knowledge platform.

The primary goal is not feature count. The primary goal is reducing friction between a thought and a saved note.

The ideal workflow is:

> Open it → write → done.

Every feature should support that philosophy.

---

## Core Principles

### Offline First Is Non-Negotiable

Freeman Notes is designed around the assumption that connectivity is unreliable.

Users should be able to create, edit, organize, search, move, and interact with their notes regardless of network availability.

The local device is not merely a cache. It is an active participant in the system.

Offline functionality should be considered during feature design from the beginning, not added afterward.

Whenever possible:

* Actions should complete immediately.
* Changes should be stored locally first.
* Synchronization should occur automatically when connectivity becomes available.
* Features should degrade gracefully rather than become unusable.

IndexedDB, Yjs, Service Workers, background synchronization, and local persistence are foundational technologies, not optional enhancements.

**This is a requirement to weigh in every change, not a feature area to remember when touching sync.**

#### A Hardcoded Time Window Is Usually A Missing Piece Of Data

The most common way offline-first gets violated is a magic number. This app runs on a gigabit wired
desktop and on a phone with two bars, and a delay tuned on the first is a silent defect on the
second — nothing throws, nothing logs, the feature simply stops working for the people on the worse
connection.

Two kinds of timer, and only one of them is legitimate:

* **Fine.** A duration that describes something human and network-independent. "They have stopped
  typing." "That was the browser's ghost click, not a second tap." "This is taking long enough that
  we should say so." The quantity *is* the meaning.
* **Suspect.** A timer standing in for a **missing identifier** — used to correlate two events that
  have nothing in common but roughly when they happened — or approximating a state that could have
  been observed directly.

For the second kind, the real defect is almost always absent data, and the fix is to make the
answer travel *with* the thing it describes. Tag the write with its cause rather than inferring the
cause from its timing. Read what actually changed rather than when it arrived. Record who did
something on the thing they did it to.

Two worked examples from this codebase, both of which shipped as bugs first:

* A note's metadata recorded `createdAt` but not **who created it**, so a second device could not
  tell its own user's new note from a collaborator's and had to correlate against a debounced
  server event. No window is correct on every connection; recording the author removes the question.
* "Did somebody trash this note" was read from a Yjs key's current value, which is identical on a
  live edit and on a cold load. No threshold can separate those; the key's `action` (`add` versus
  `update`) separates them exactly, on any connection, every time.

If a window is genuinely unavoidable, derive it from something real — a documented server-side
debounce, a measured p99 — write the derivation in the comment beside it, and state which direction
it fails in. Never pick a round number because it felt safe.

---

### Real-Time Means Truly Real-Time

Freeman Notes should feel alive.

When a change occurs, every part of the application that depends on that data should update immediately.

Examples:

* Changing a user's avatar should update everywhere that avatar appears.
* Renaming a workspace should update every open view.
* Editing a note should update all active clients.
* Collaboration should feel instantaneous.

The application should behave as a synchronized system rather than a collection of disconnected screens.

State duplication should be minimized whenever possible.

There should be a single source of truth for shared data.

---

### Performance Is A Feature

Speed is not an optimization. It is a product requirement.

Users should never feel like they are waiting for the application.

Design decisions should prioritize:

* Instant interaction
* Low latency
* Efficient rendering
* Minimal unnecessary re-renders
* Scalable data structures
* Predictable performance

Virtualization should be used whenever datasets can grow large.

Large workspaces, large note collections, and large documents should remain responsive.

The application should continue to feel fast with thousands of notes.

---

### Responsive Means More Than Screen Size

Freeman Notes should feel natural on:

* Phones
* Tablets
* Laptops
* Desktops
* PWAs installed on any platform

The experience should be designed for touch and mouse users equally.

Mobile should never be treated as a second-class experience.

Whenever possible, interfaces should adapt rather than fork into entirely separate implementations.

---

### Progressive Web App First

The PWA is the primary application platform.

Users should be able to install Freeman Notes and use it as though it were a native application.

The PWA should support:

* Offline operation
* Background synchronization
* Push notifications
* Local caching
* Fast startup
* Reliable updates

Service workers are considered core infrastructure.

The application should continue to improve its native-like behavior over time.

---

### Future Native Applications

The architecture should support eventual native clients.

Future native applications may exist for:

* Android
* iOS
* Windows
* macOS

Business logic, synchronization, persistence models, APIs, and collaboration systems should be designed with this future in mind.

Platform-specific UI is acceptable.

Platform-specific business rules are not.

The backend and synchronization architecture should remain platform-agnostic.

---

## User Experience Philosophy

### Simplicity Over Complexity

Users should not be required to understand the system in order to use it.

The most common actions should be obvious.

Advanced functionality should be discoverable without overwhelming new users.

A simple solution is preferred over a powerful solution unless the additional complexity provides meaningful user value.

---

### Predictability Over Cleverness

Users should be able to build trust in the application.

Interactions should behave consistently.

Features should avoid surprising outcomes.

When there is a choice between a clever implementation and a predictable implementation, choose predictability.

---

### Structure Should Be Visible

Organization is a core feature.

Hierarchy, relationships, and ownership of content should be visually clear.

Users should always understand:

* Where content belongs
* What content is hidden
* What content is shared
* What content is synchronized

The system should avoid creating invisible or ambiguous states.

---

### The Interface Must Not Move Under the User

This is the principle the most design effort has gone into, so it is stated plainly.

A note's position on the grid is how people find it. Position is memory. Anything that rearranges
the grid while somebody is reading it destroys that memory and costs them their place.

Arriving data is not a reason to rearrange what somebody is looking at.

There are three ways it happens, and they are one problem, not three:

* A note is **added** and everything below it is pushed down.
* A note is **removed** and the gap closes up.
* A note is **edited** and the card changes height where it sits.

So a change made by somebody else is **held, not applied**. It is announced, counted, and applied
at a moment the user chose. The user's own changes are never held: being asked to approve your own
typing is absurd, and a note created on the device in front of you must appear instantly.

Two things follow, and both have been learned the expensive way:

**A card's height is a function of its content.** "Hold the height but show the new content" is a
contradiction, and it yields either empty space or controls pushed off the card. There is no third
outcome. Freezing the card's content instead turns it into a stale snapshot, which has to disable
editing to stay honest. Both were tried and both were reverted. Hold the *change*, never the
*card*.

**Announcing a change must cost less than the change itself.** A marker that re-measures, re-packs
or animates size feeds the layout loop it was meant to protect. Treatments are drawn over the card,
out of layout, participating in nothing.

---

### Collaboration Without Compromise

Collaboration is important, but single-user workflows should never suffer because of collaboration requirements.

A user working alone should enjoy the same speed and simplicity as a user collaborating with a team.

Collaboration should enhance the experience rather than dominate it.

---

## Product Identity

Freeman Notes draws inspiration from:

* Google Keep (simplicity)
* Workflowy (hierarchy)
* Obsidian (knowledge management)
* Modern collaborative editors (real-time synchronization)

However, Freeman Notes is not attempting to become a Notion clone.

It is not intended to become a generic workspace platform.

Its identity remains rooted in notes, documents, organization, and knowledge capture.

Every new feature should strengthen that identity rather than dilute it.

---

## Decision Rule

When evaluating a feature, architecture change, or implementation detail, ask:

1. Does it improve speed?
2. Does it improve offline capability?
3. Does it improve synchronization consistency?
4. Does it improve user understanding?
5. Does it maintain simplicity?

If the answer to most of those questions is "no", the change should be reconsidered.
