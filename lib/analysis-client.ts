import { analysisSchema, type Analysis } from './analysis';

export async function readAnalysisResponse(response: Response): Promise<Analysis> {
  const genericError = response.status === 504
    ? '分析超时，照片已保留，请稍后重试。'
    : '未收到有效分析响应，请检查网络连接后重试。';
  function result(payload: unknown): Analysis {
    const body = payload as { analysis?: unknown; error?: unknown } | null;
    if (typeof body?.error === 'string') throw Error(body.error);
    const parsed = analysisSchema.safeParse(body?.analysis);
    if (!response.ok || !parsed.success) throw Error(genericError);
    return parsed.data;
  }
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
    let payload: unknown;
    try { payload = await response.json(); } catch { throw Error(genericError); }
    return result(payload);
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error(genericError);
  const decoder = new TextDecoder();
  let buffer = '', total = 0;
  let final: Analysis | undefined;
  function line(value: string) {
    if (!value.trim()) return;
    let payload: { type?: string } | null;
    try { payload = JSON.parse(value); } catch { throw Error(genericError); }
    if (payload?.type === 'result') final = result(payload);
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 1_000_000) throw Error(genericError);
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 1);
      }
    }
    line(buffer + decoder.decode());
    if (!final) throw Error('分析连接已中断，照片已保留，请重试。');
    return final;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
