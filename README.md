# karpathy.ai

A mobile-friendly web app that combines an Obsidian-style Markdown vault with an
AI dialog — so that the knowledge (the `.md` files) and the AI assistant that reads,
writes, and ingests into it can be used **on iPad and phone**, not just in the
terminal on the Mac.

## Problem

The existing setup is: Obsidian vault + Claude Code (CLI) + skills, all local on
the Mac. On mobile, only reading/editing the `.md` files works (Obsidian app). The
**AI + skills** are tied to the terminal and the Mac.

## Solution

A web app (PWA) that unites two things in one place:

1. **Obsidian core:** list, read, edit, search `.md` files (wikilinks,
   frontmatter).
2. **AI dialog:** chat UI in the app; an external LLM (Claude) is called; the
   **agentic loop runs in the backend on an existing harness** (Claude Agent SDK)
   and gets tools to search and edit exactly these `.md` files.

Core idea: **don't** build the agentic loop, tool calling, and skills yourself —
the Claude Agent SDK is Claude Code as a library and brings file tools, skills,
`CLAUDE.md`, and MCP. Only the frontend (editor + chat) and a thin backend
(file API + SDK session + git sync) get built.

## Sync

The vault stays a **git repo**. The backend commits/pushes to GitHub; Obsidian
mobile and desktop are attached to the same remote. No second sync system.

## Status

Specification. See [`specs/mvp.md`](specs/mvp.md).

## Name

Working title `karpathy.ai` — placeholder.
