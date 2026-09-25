import type { ChatDetail, ChatEvent, ChatSummary } from '@karpathy/shared';

// Placeholder until the opencode spike lands; replaced by the real service.
export interface ChatService {
  list(vaultId: string): Promise<ChatSummary[]>;
  create(vaultId: string): Promise<{ chatId: string }>;
  get(vaultId: string, chatId: string): Promise<ChatDetail>;
  remove(vaultId: string, chatId: string): Promise<void>;
  prompt(vaultId: string, chatId: string, text: string): Promise<void>;
  stream(vaultId: string, chatId: string, send: (e: ChatEvent) => void, end: () => void): () => void;
  abort(vaultId: string, chatId: string): Promise<void>;
}
