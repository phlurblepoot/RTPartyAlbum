import { customAlphabet } from 'nanoid';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const CODE_LENGTH = 6;
const MAX_RETRIES = 20;
const nano = customAlphabet(ALPHABET, CODE_LENGTH);

export interface CodeChecker {
  codeExists(code: string): boolean;
}

/** Generate a unique 6-char lowercase alphanumeric event code, retrying on collision. */
export function generateUniqueCode(repo: CodeChecker): string {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const code = nano();
    if (!repo.codeExists(code)) return code;
  }
  throw new Error('failed to generate unique event code');
}
