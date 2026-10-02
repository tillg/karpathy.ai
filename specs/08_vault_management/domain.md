---
feature: 08_vault_management
title: "Domain: vault structure, GitHub token, attach preflight"
status: applied
order: 2
created: 2026-10-02
edited: 2026-10-02
---

# Domain: vault structure, GitHub token, attach preflight

Builds on the terms in `CONTEXT.md` and [specs/system/domain.md](../system/domain.md) (Vault, Vault root,
Vault state, Uncommitted change, Commit). New and changed terms:

## New terms

| Term | Meaning |
|---|---|
| **Vault structure** | The folders a vault is expected to have under its **vault root**: `Sources/` and `Wiki/` (required) and `Schema/` (optional). The app checks the required ones only when a vault is attached. |
| **Sources** | `Sources/`: immutable source documents (articles, mails, PDFs, clips). Humans or ingest skills add them. They are not rewritten afterwards. |
| **Wiki** | `Wiki/`: the knowledge base the AI maintains from the sources (entities, concepts, topics, syntheses, index, log). |
| **Schema** | `Schema/`: optional instructions for the AI (e.g. `Schema/CLAUDE.md`, methodology). Mentioned in the help only. |
| **Missing folders** | The required folders that are absent from the vault root of a repo being attached. |
| **Attach preflight** | The check that runs when a vault is added, before anything is stored: repo reachable with the GitHub token, branch exists, vault root exists, missing folders listed. |
| **Folder placeholder** | An empty `.gitkeep` file that makes a created folder exist in git (git does not track empty folders). It is an uncommitted change like any other. |
| **GitHub token** | The single, server-wide credential the backend uses for every git operation against GitHub (clone, pull, push). It is now part of the settings. It is never sent to the client in full, never given to the AI, and never written into a repo. |
| **Token source** | Where the active token comes from: `settings` (set in the app) or `secret` (the deployment's `GITHUB_TOKEN` secret, used when no token is set in the app). |
| **Token test** | A check of a token, either the stored one or one typed but not saved yet, against GitHub: is it accepted, whose is it, its scopes and expiry, and can it reach each vault's repo. |

## Changed terms

- **Vault**: adding a vault no longer means "stored, then cloned". A vault exists in the config only after
  the attach preflight passes and, if folders were missing, the user agrees to create them.
- **Settings**: before, the reminder threshold and the model. Now also the GitHub token.

## Attach process

```mermaid
sequenceDiagram
  actor U as User
  participant W as Web app
  participant B as Backend
  participant G as GitHub
  U->>W: Add vault (repo, branch, root)
  W->>B: POST /vaults
  B->>G: shallow fetch of branch (token)
  alt no access / no branch / no root
    B-->>W: 4xx with reason
    W-->>U: inline error, nothing attached
  else Sources/ or Wiki/ missing
    B-->>W: 409 missing-folders [Sources, Wiki]
    W->>U: "Create Sources/ and Wiki/?"
    alt No
      W-->>U: back to list, nothing attached
    else Yes
      W->>B: POST /vaults createFolders=true
      B-->>W: 202 (vault stored, cloning)
      B->>B: clone, then write .gitkeep in each missing folder
    end
  else all present
    B-->>W: 202 (vault stored, cloning)
  end
```

## Vault state (extended)

The preflight comes before the vault exists, so it is not a vault state. The states after it are unchanged.

```mermaid
stateDiagram-v2
  [*] --> preflight: Add vault
  preflight --> [*]: error, or user declines folders (not attached)
  preflight --> cloning: passes (folders present or created)
  cloning --> ready
  cloning --> clone_failed
  clone_failed --> cloning: Retry
  ready --> conflict
  conflict --> ready
```

## Entities

```mermaid
erDiagram
  SETTINGS ||--o| GITHUB_TOKEN : "holds (optional)"
  SECRET ||--o| GITHUB_TOKEN : "fallback"
  GITHUB_TOKEN ||--o{ VAULT : "authenticates git for"
  VAULT ||--|| VAULT_ROOT : has
  VAULT_ROOT ||--|| SOURCES : "requires"
  VAULT_ROOT ||--|| WIKI : "requires"
  VAULT_ROOT ||--o| SCHEMA : "may have"
```

## Parties

- **User**: sets and tests the token, attaches vaults, decides whether missing folders are created.
- **GitHub**: checks the token (`/user`) and serves the repos. The only external party.
- **AI (opencode)**: not involved. It never sees the token and has no part in attaching vaults.
