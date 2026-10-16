// The returning reader's identity, kept on this device. The owl's memory of
// them lives in SurrealDB on the backend; these keys only say who is reading.

export const READER_NAME_KEY = "narrateme:reader-name";
export const READER_ID_KEY = "narrateme:reader-id";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Mirrors backend/app/models/reader.py; every field there is optional.
export type PreviousSession = {
  last_story: string | null;
  last_word: string | null;
  last_seen: string | null;
};

export type ReaderSession = {
  reader_id: string;
  name: string;
  is_returning: boolean;
  previous_session: PreviousSession | null;
};

// Letters, with spaces/hyphens/apostrophes between them ("Mary-Kate", "D'Andre").
const NAME_PATTERN = /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/;

export function validateReaderName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 2) return "Your name needs at least 2 letters.";
  if (name.length > 20) return "That's a long name! Try 20 letters or fewer.";
  if (!NAME_PATTERN.test(name)) return "Letters only, please.";
  return null;
}

// localStorage can throw (private mode, blocked storage), so every access is guarded.
export function getReaderName(): string | null {
  try {
    return localStorage.getItem(READER_NAME_KEY);
  } catch {
    return null;
  }
}

export function getReaderId(): string | null {
  try {
    return localStorage.getItem(READER_ID_KEY);
  } catch {
    return null;
  }
}

export function saveReader(name: string, readerId?: string | null) {
  try {
    localStorage.setItem(READER_NAME_KEY, name);
    if (readerId) localStorage.setItem(READER_ID_KEY, readerId);
  } catch {
    // Storage unavailable: the name just won't survive a reload.
  }
}

export function clearReader() {
  try {
    localStorage.removeItem(READER_NAME_KEY);
    localStorage.removeItem(READER_ID_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** POST /api/reader/session. Returns null when the backend is unreachable. */
export async function postReaderSession(body: {
  name: string;
  story_snippet: string;
  practice_word: string | null;
}): Promise<ReaderSession | null> {
  try {
    const res = await fetch(`${API_URL}/api/reader/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // A hung backend must never keep a kid stuck on the name prompt.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ReaderSession;
  } catch {
    return null;
  }
}
