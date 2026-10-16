"use client";

import { useEffect, useState } from "react";
import OwlAvatar from "./OwlAvatar";
import type { PreviousSession } from "../lib/reader";

interface WelcomeMessageProps {
  name: string;
  isReturning: boolean;
  previousSession?: PreviousSession | null;
}

const AUTO_HIDE_MS = 8000;

// Build the owl's greeting. The name modal registers a reader before their
// first story, so the backend can report is_returning with nothing remembered
// yet; only treat it as a return visit once there's a story or word to recall.
function greeting(name: string, isReturning: boolean, previous?: PreviousSession | null) {
  const story = isReturning ? previous?.last_story?.trim() : undefined;
  const word = isReturning ? previous?.last_word?.trim() : undefined;

  if (story && word) {
    return `Welcome back, ${name}! Last time we read about '${story}' and you practiced the word '${word}'. Ready for another adventure?`;
  }
  if (story) {
    return `Welcome back, ${name}! Last time we read about '${story}'. Ready for another adventure?`;
  }
  if (word) {
    return `Welcome back, ${name}! Last time you practiced the word '${word}'. Ready for another adventure?`;
  }
  return `Hi ${name}! I'm so excited to read with you today! 🦉`;
}

// Owl speech bubble shown above the story. Fades in, then hides itself after a
// few seconds or on the first click/tap anywhere, so it never blocks playback.
export default function WelcomeMessage({ name, isReturning, previousSession }: WelcomeMessageProps) {
  const [visible, setVisible] = useState(true);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // Flip opacity on the next frame so the fade-in transition actually runs.
    const frame = requestAnimationFrame(() => setShown(true));
    const timer = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    const dismiss = () => setVisible(false);
    document.addEventListener("pointerdown", dismiss);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      className={
        "mb-6 flex w-full max-w-4xl cursor-pointer items-center gap-3 transition-opacity duration-500 sm:gap-4 " +
        (shown ? "opacity-100" : "opacity-0")
      }
    >
      <div className="relative h-16 w-16 shrink-0 sm:h-20 sm:w-20">
        <OwlAvatar
          emotion="happy"
          className="!static !h-full !w-full !translate-x-0 !translate-y-0 !left-auto !bottom-auto"
        />
      </div>
      <p className="relative rounded-2xl bg-white px-4 py-3 text-base leading-relaxed text-zinc-800 shadow-lg dark:bg-zinc-900 dark:text-zinc-200 sm:text-lg">
        {greeting(name, isReturning, previousSession)}
      </p>
    </div>
  );
}
