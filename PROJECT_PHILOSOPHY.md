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
