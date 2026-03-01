# FreemanNotes 📝

**Your notes, your rules — the Keep experience, supercharged like a HEV suit.**

FreemanNotes isn’t just another note app. It’s a self-hosted, CRDT-powered, offline-first note and checklist platform that does things Google Keep can’t: advanced media, flexible organization, rich collaboration, and smart offline-first editing — all under your control. Think of it as the lab notebook Gordon Freeman would actually use in Black Mesa: everything tracked, everything structured, nothing lost.

---

## Why FreemanNotes is Better

- **Canonical Note Model** — Every note has a stable identity, timestamps, metadata, and content. Cross-device edits converge automatically; no more lost changes or conflicts.  
- **Offline-First & Crash-Proof** — Edit notes in your bunker, offline lab, or Lambda Complex. Everything persists locally, syncs when the network returns, and survives browser crashes.  
- **Checklist CRDT Safety** — Add, remove, or update checklist items safely in real-time. Merge conflicts? Not on Freeman’s watch.  
- **Drag-and-Drop Grid** — dnd-kit-powered masonry works seamlessly on desktop, tablet, and touch devices. Portrait, landscape, or multi-column layouts adapt automatically.  
- **Collections & Smart Sorting** — Organize by folders, collections, due dates, tags, or collaborator. No more chaotic stacks of notes like a misfired resonance cascade.  
- **Media & URL Handling** — Notes aren’t just text: images, PDFs, videos, and links live inside cards with instant previews.  
- **Connection-Aware Collaboration** — Know if you’re connected, reconnecting, or offline. Local edits never block your workflow.  
- **Developer-Friendly** — Dev-only guards and logging help prevent orphan notes, duplicate IDs, or messy merges.

---

## Core Features at a Glance

- **Notes & Checklists** — text, checkable items, and media  
- **Offline-first + auto-sync** — CRDT-safe, merges across devices seamlessly  
- **Advanced media & galleries** — preview images, PDFs, videos, URLs  
- **Collections & folders** — nested organization without chaos  
- **Smart filtering & sorting** — by tags, collaborators, due date, collection  
- **Drag & drop masonry** — works across desktop, PWA, and mobile  
- **Connection status awareness** — see if you’re synced or offline  
- **Extensible** — future Markdown & rich-text, custom themes, font size preferences  

---

## Tech Stack

- **Frontend:** React + TypeScript + dnd-kit  
- **CRDT Engine:** Yjs + y-websocket  
- **Offline Persistence:** IndexedDB + service workers  
- **Future Backend:** PostgreSQL + optional Redis for multi-instance setups  

---

## Roadmap

- Markdown & rich-text editor (think lab logs with formatted formulas)  
- User-customizable themes, font sizes, and checkbox styles  
- Mobile masonry layouts optimized for portrait and landscape  
- Advanced collaboration: sharing, permissions, real-time edits by multiple users  
- Postgres-powered persistent note order & cross-device consistency  

---

FreemanNotes is **not just “like Keep”** — it’s your own Half-Life 2 inspired lab notebook: smarter, safer, more powerful, and fully under your control.
