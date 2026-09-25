# karpathy.ai

A mobile-friendly app for reading, editing, and talking to an AI about Markdown vaults that live in GitHub repos.

## Language

### Vaults

**Vault**:
A GitHub repo (optionally a subfolder of it) whose Markdown notes the app works on. The app holds no content of its own.
_Avoid_: Workspace, project, notebook

**Vault root**:
The folder inside the repo that the vault starts at; the repo root unless a subfolder was configured.

**Active vault**:
The one vault the UI is currently scoped to; every file, search, and chat operation targets it.

### AI

**Chat**:
A resumable conversation with the AI, bound to exactly one vault; each vault keeps a list of past chats. The AI's reach is limited to that vault's root.
_Avoid_: Session, thread, conversation

**Turn**:
One user prompt in a chat plus everything the AI reads and changes in response.

### Changes

**Uncommitted change**:
A file in a vault that differs from its last commit, whether the user or the AI changed it. Both are pooled together until the next commit.
_Avoid_: Draft, pending edit, dirty file

**Unsaved change**:
An edit held only in the editor that hasn't been written to the vault yet.

**Commit**:
The user-triggered act of recording all uncommitted changes of a vault and pushing them to GitHub in one step. There is no commit without a push.
_Avoid_: Sync, save, publish

**Unpushed commit**:
A commit whose push failed; it stays local and is pushed again on the next commit or pull. If GitHub has moved on in the meantime, the next pull turns it back into uncommitted changes.

**Commit reminder**:
A prompt that appears once the number of uncommitted changes passes a configurable threshold, offering to commit right away.

**Stale save**:
A save rejected because the file changed (by the AI or a pull) since the editor loaded it.
_Avoid_: Conflict (reserved for git)

**Conflict**:
A git-level clash between the vault's uncommitted changes and changes pulled from GitHub (e.g. from Obsidian). It blocks writes to the vault until the user resolves each clashing file (keep mine / theirs / both).

### Editor

**Write mode**:
The default way a note opens: raw Markdown with live preview, editable.
_Avoid_: Edit mode, source mode

**Read mode**:
A rendered, non-editable view of a note that the user can switch to.
_Avoid_: Preview
