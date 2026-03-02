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
- **Offline Persistence:** IndexedDB (client-side cache)  
- **Backend:** Node.js + PostgreSQL (Prisma ORM) + optional Redis  
- **Deployment:** Docker / Docker Compose / Unraid  

---

## Quick Start (Docker Compose)

The easiest way to run FreemanNotes with a fully managed database:

```bash
# Clone the repo
git clone https://github.com/DaxtonD/freemannotes.git
cd freemannotes

# Start everything (app + Postgres)
docker compose up -d
```

This starts:
- **FreemanNotes** on `http://localhost:27015`
- **PostgreSQL 16** with persistent storage (volume: `freemannotes-pgdata`)

The app automatically creates the database, runs migrations, and seeds the default workspace on first boot. No manual setup required.

### Optional: Enable Redis caching

Uncomment the `redis` service in `docker-compose.yml` and add:
```yaml
REDIS_URL: redis://redis:6379
```

---

## Unraid / External Database Setup

If you already have a PostgreSQL instance (e.g. on Unraid, a NAS, or a managed cloud DB):

1. **Create the database** (or let the app auto-create it):
   ```sql
   CREATE DATABASE freemannotes;
   ```

2. **Set `DATABASE_URL`** in your container environment:
   ```
   DATABASE_URL=postgresql://user:password@your-postgres-host:5432/freemannotes?schema=public
   ```

3. **Run the container:**
   ```bash
   docker run -d \
     --name freemannotes \
     -p 27015:27015 \
     -e NODE_ENV=production \
     -e DATABASE_URL="postgresql://user:password@your-postgres-host:5432/freemannotes?schema=public" \
     ghcr.io/daxtond/freemannotes:latest
   ```

The server automatically:
- Creates the database if it doesn't exist (requires admin privileges on the PG instance)
- Runs `prisma migrate deploy` (production) to apply pending migrations
- Seeds the default workspace on first boot

### Unraid Community Apps

For Unraid users, add as a Docker container with these key fields:
| Field | Value |
|-------|-------|
| Repository | `ghcr.io/daxtond/freemannotes:latest` |
| WebUI | `http://[IP]:[PORT:27015]` |
| Port | `27015` → `27015` |
| `DATABASE_URL` | `postgresql://user:pass@your-pg-ip:5432/freemannotes?schema=public` |
| `NODE_ENV` | `production` |
| `REDIS_URL` *(optional)* | `redis://your-redis-ip:6379` |
| `PGTIMEZONE` *(optional)* | `America/Regina` (or your IANA timezone) |

---

## Local Development

```bash
# Install dependencies
npm install

# Start Postgres (via Docker Compose or your own instance)
docker compose up postgres -d

# Copy and edit environment
cp .env.example .env
# Edit DATABASE_URL if needed

# Run dev server (auto-syncs schema + starts Vite)
npm run dev
```

### Database Commands

| Command | Purpose |
|---------|---------|
| `npm run db:migrate` | Create a new migration (dev) |
| `npm run db:migrate:deploy` | Apply pending migrations (production) |
| `npm run db:migrate:status` | Check migration status |
| `npm run db:push` | Push schema without migrations (dev shortcut) |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:init` | Create DB + sync schema (called automatically on `npm run dev`) |

### Migration Workflow

```bash
# 1. Edit prisma/schema.prisma
# 2. Create a migration:
npm run db:migrate -- --name add_new_field
# 3. Commit the generated migration files
# 4. In production, migrations are applied automatically on server boot
```

---

## Roadmap

- Markdown & rich-text editor (think lab logs with formatted formulas)  
- User-customizable themes, font sizes, and checkbox styles  
- Mobile masonry layouts optimized for portrait and landscape  
- Advanced collaboration: sharing, permissions, real-time edits by multiple users  
- Postgres-powered persistent note order & cross-device consistency  

---

FreemanNotes is **not just “like Keep”** — it’s your own Half-Life 2 inspired lab notebook: smarter, safer, more powerful, and fully under your control.
