import { tool } from '@opencode-ai/plugin';
import { resolveNote } from '../lib/resolve-note.ts';

// Baked into the opencode image (Dockerfile), never loaded from a vault. It only checks the path; the
// web app sees the completed call in the chat stream and opens the note (ToolCall.opens).
export default tool({
  description:
    "Open a note (page) in the user's editor so they can see it. Use it only when the user asks to see, show or open a note. Path is relative to the vault root, as for read. Do not call it for files you read or write unless the user asked to see them.",
  args: { path: tool.schema.string().describe('Vault-relative path of the note, e.g. Lists/Reading.md') },
  async execute(args, context) {
    return `opened ${await resolveNote(context.directory, args.path)}`;
  },
});
