// Memory Owl: client for the reader-session endpoint (POST /api/reader/session),
// which remembers a reader by name across visits. Shapes mirror
// backend/app/models/reader.py, where every previous-session field is optional.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// localStorage keys written by the name modal on the home page.
export const READER_NAME_KEY = "narrateme:reader-name";
export const READER_ID_KEY = "narrateme:reader-id";

export interface PreviousSession {
  last_story: string | null;
  last_word: string | null;
  last_seen: string | null;
}

export interface ReaderData {
  name: string;
  is_returning: boolean;
  previous_session: PreviousSession | null;
}

interface ReaderSessionResponse extends ReaderData {
  reader_id: string;
}

export function getStoredReaderName(): string | null {
  try {
    return localStorage.getItem(READER_NAME_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

// Record a session for `name` and return what the backend remembered from the
// previous one. The backend only overwrites last_story / last_word when they're
// provided, so a call with neither just looks the reader up (and bumps
// last_seen). Returns null on any failure so callers can degrade gracefully.
export async function postReaderSession(
  name: string,
  storySnippet: string | null = null,
  practiceWord: string | null = null,
  signal?: AbortSignal
): Promise<ReaderSessionResponse | null> {
  try {
    const res = await fetch(`${API_URL}/api/reader/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        story_snippet: storySnippet,
        practice_word: practiceWord,
      }),
      signal,
    });
    if (!res.ok) return null;
    const data: ReaderSessionResponse = await res.json();
    try {
      localStorage.setItem(READER_ID_KEY, data.reader_id);
    } catch {
      // Storage unavailable (private mode): the backend keys on name anyway.
    }
    return data;
  } catch {
    return null;
  }
}

// First ~50 characters of the story for the "last time we read about..." line,
// cut back to a word boundary so it doesn't end mid-word.
export function storySnippet(text: string, maxLength = 50): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.!?-]+$/, "");
}
