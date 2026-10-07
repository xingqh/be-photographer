export const providers = {
  deepseek: { name: 'DeepSeek', label: 'DeepSeek Flash', model: 'deepseek-flash', endpoint: 'https://api.deepseek.com/responses' },
  openai: { name: 'OpenAI', label: 'OpenAI · GPT-4.1 mini', model: 'gpt-4.1-mini', endpoint: 'https://api.openai.com/v1/responses' },
} as const;
export type Provider = keyof typeof providers;
export const analysisTimeoutMs = 120_000;
export const clientTimeoutMs = analysisTimeoutMs + 10_000;
export function validApiKey(key: string) {
  return key.trim().length <= 500 && /^sk-[A-Za-z0-9_-]{17,}$/.test(key.trim());
}
