import { readError, UpstreamError } from '../google/errors.js';

// REST reference: https://ai.google.dev/api/generate-content
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// A slow answer on stage is worse than the fallback, so give up quickly.
const TIMEOUT_MS = 8000;

export interface GeminiSettings {
  apiKey: string;
  model: string;
}

// Sends one prompt and asks Gemini to answer with JSON matching `schema`.
// Returns the parsed JSON as `unknown`: callers must check its shape themselves.
export async function generateJson(
  settings: GeminiSettings,
  prompt: string,
  schema: object,
  fetchFn: typeof fetch = fetch,
): Promise<unknown> {
  const res = await fetchFn(`${BASE}/${encodeURIComponent(settings.model)}:generateContent`, {
    method: 'POST',
    // Key goes in a header, not the URL, so it never shows up in logged URLs.
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new UpstreamError('Gemini API', res.status, await readError(res));

  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) throw new Error('Gemini returned no text');
  return JSON.parse(text);
}
