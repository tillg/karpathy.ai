// API types shared by backend and web. All routes sit under /api (mvp §3.2).

export type VaultState = 'cloning' | 'ready' | 'clone-failed' | 'conflict';

export interface VaultConfig {
  id: string;
  name: string;
  /** GitHub repo as `owner/name`. */
  repo: string;
  branch: string;
  /** Subfolder of the repo the vault starts at; '' = repo root. */
  root: string;
}

export interface Vault extends VaultConfig {
  state: VaultState;
  /** Git error when state is `clone-failed`. */
  error?: string;
}

export interface Settings {
  commitReminderThreshold: number;
  /** `provider/model`, e.g. `anthropic/claude-sonnet-5`. */
  model: string;
}

export type Busy = 'none' | 'turn' | 'sync';

export interface VaultStatus {
  state: VaultState;
  changedCount: number;
  unpushedCount: number;
  busy: Busy;
  /** Vault-root-relative paths that are still unresolved while in Conflict. */
  conflictPaths: string[];
}

export interface FileEntry {
  /** Vault-root-relative, `/`-separated. */
  path: string;
  type: 'file' | 'dir';
}

export interface FileContent {
  path: string;
  content: string;
  /** Content hash; send back as `version` on PUT. */
  version: string;
}

export interface PutFileRequest {
  content: string;
  /** Version the editor loaded; null when creating a new file. */
  version: string | null;
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

export interface Change {
  path: string;
  kind: ChangeKind;
}

export interface Diff {
  path: string;
  diff: string;
}

export type ConflictChoice = 'mine' | 'theirs' | 'both';

export interface CommitResult {
  /** Commit hash, or null when nothing was committed. */
  commit: string | null;
  pushed: boolean;
  pushError?: string;
}

/** Live vault event stream (`GET /vaults/:id/events`), one JSON object per line. */
export type VaultEvent =
  | { type: 'status'; status: VaultStatus }
  | { type: 'files-changed'; files: { path: string; version: string | null }[] };

// ---- Chat (ACP-shaped: session / prompt / update / tool_call / permission) ----

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export type ToolStatus = 'pending' | 'running' | 'completed' | 'error' | 'denied';

export interface ToolCall {
  id: string;
  tool: string;
  status: ToolStatus;
  /** Vault-root-relative path the tool reads/changes, if any. */
  path?: string;
  /** True when the tool changes files (edit/write/patch). */
  writes: boolean;
  title?: string;
  error?: string;
}

export type ChatPart =
  | { type: 'text'; id: string; text: string }
  | { type: 'reasoning'; id: string; text: string }
  | { type: 'tool'; id: string; call: ToolCall };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: ChatPart[];
  createdAt: number;
  error?: string;
}

export interface ChatDetail {
  id: string;
  title: string;
  messages: ChatMessage[];
  turn: TurnState;
}

export type TurnState = 'idle' | 'queued' | 'running';

/** Chat stream (`GET /vaults/:id/chats/:chatId/stream`), one JSON object per line. */
export type ChatEvent =
  | { type: 'turn'; state: TurnState; readonly?: boolean }
  | { type: 'message'; message: Omit<ChatMessage, 'parts'> }
  | { type: 'part'; messageId: string; part: ChatPart }
  | { type: 'text-delta'; messageId: string; partId: string; delta: string }
  | { type: 'error'; message: string };

export interface ApiError {
  error: string;
  code?: string;
}
