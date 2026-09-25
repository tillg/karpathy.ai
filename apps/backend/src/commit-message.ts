export interface CommitMessages {
  propose(vaultId: string): Promise<{ message: string; fallback: boolean }>;
}
