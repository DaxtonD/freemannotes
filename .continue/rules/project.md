# Project Overview
This is a an offline-first note-taking application called Freeman Notes. It's built using React + TypeScript + javasctipt + python + Swift + Kotlin + Prisma. full-stack app with user auth.

## Folder Structure
- `prisma/` → prisma migrations and schema
- `public/` → sw.js + icons + locales
- `server/` → server source code. yjs, routers, database init
- `src/` → Main source code
- `src/components/` → React components

## Key Technologies
- atlaskit, extractus, fortawesome, hello-pangea/dnd, prisma, tiptap, bcryptjs, busboy, dotenv, framer-motion, heic-convert, ioredis, jsonwebtoken, jszip, mammoth, markdown-it, nodemailer, pdf-parse, pg, qrcode, react, react-dom, react-easy-crop, sharp, turndown, ws, y-indexeddb, y-prosemirror, y-websocket, yjs

## Coding Standards
- Use functional components with hooks
- TypeScript strict mode

## Project Rules

- This is a React + TypeScript application.
- Main entry point is `src/app.tsx` (not App.js).
- Use functional components and hooks.
- State management is done with React hooks (useState, useEffect, useContext, etc.).
- For persistence across refreshes, prefer localStorage.
- Never assume file names — always explore the actual filesystem first.

## Common Patterns
