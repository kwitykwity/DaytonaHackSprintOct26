"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { postReaderSession, saveReader, validateReaderName } from "../lib/reader";

/**
 * First-visit "What's your name?" prompt so the owl can remember the reader.
 *
 * The name is saved locally before the backend call, so a down backend never
 * blocks reading: the kid still gets in, just without the owl's memory.
 */
export default function NameModal({
  open,
  onDone,
}: {
  open: boolean;
  onDone: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateReaderName(name);
    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }

    const cleanName = name.trim();
    setSubmitting(true);
    saveReader(cleanName);

    const session = await postReaderSession({
      name: cleanName,
      story_snippet: "",
      practice_word: null,
    });
    if (session) {
      saveReader(cleanName, session.reader_id);
    } else {
      console.warn("Reader session not saved: backend unavailable. Name kept locally.");
    }

    setSubmitting(false);
    onDone(cleanName);
  };

  if (!open) return null;

  // Portalled to body for the same reason as ParentSettings: the header's
  // backdrop-filter would otherwise become the containing block.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-dark/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-modal-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-[var(--radius-jumbo)] bg-surface-base p-8 text-center shadow-2xl"
      >
        <img
          src="/owls/happy.png"
          alt="A happy owl waving hello"
          className="mx-auto mb-4 h-32 w-32 object-contain"
        />
        <h2 id="name-modal-title" className="mb-2 text-3xl font-extrabold text-ink-dark">
          Hi there! What&apos;s your name?
        </h2>
        <p className="mb-6 text-gray-500">
          I&apos;m your reading owl. Tell me your name and I&apos;ll remember you next time!
        </p>

        <label htmlFor="reader-name" className="sr-only">
          Your name
        </label>
        <input
          id="reader-name"
          ref={inputRef}
          type="text"
          autoComplete="off"
          maxLength={20}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="Type your name"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "reader-name-error" : undefined}
          className="w-full rounded-2xl border-2 border-border-fine bg-surface-raised px-5 py-4 text-center text-2xl font-bold text-ink-dark outline-none focus:border-accent-teal"
        />

        {error && (
          <p id="reader-name-error" className="mt-3 text-sm font-semibold text-red-600" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || name.trim().length < 2}
          className="mt-6 w-full rounded-full bg-accent-teal px-8 py-4 text-lg font-bold text-white shadow-lg transition-all hover:scale-105 hover:bg-ink-dark disabled:opacity-40 disabled:hover:scale-100 disabled:hover:bg-accent-teal cursor-pointer"
        >
          {submitting ? "Saving..." : "Start Reading!"}
        </button>
      </form>
    </div>,
    document.body
  );
}
