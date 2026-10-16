"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import OwlAvatar from "./OwlAvatar";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { usePromptAudio } from "../hooks/usePromptAudio";
import { validateAnswer } from "../utils/answerValidation";

interface EngagementPrompt {
  type: "reading_prompt" | "sound_cue" | "comprehension_check";
  text: string;
  timing: "before" | "after";
  answer_hint?: string;
}

interface EngagementModalProps {
  prompt: EngagementPrompt;
  onDismiss: () => void;
  // Memory Owl: called with the practice word when a comprehension check is
  // finished, just before onDismiss.
  onPracticeWord?: (word: string) => void;
}

// Question and filler words to skip when picking a practice word.
const NON_KEYWORDS = new Set([
  "what", "who", "whom", "whose", "where", "when", "why", "how", "which",
  "does", "did", "were", "was", "are", "is", "the", "and", "you", "your",
  "they", "them", "their", "she", "her", "his", "him", "its", "that", "this",
  "these", "those", "there", "then", "with", "from", "into", "about", "after",
  "before", "have", "has", "had", "can", "could", "would", "should", "will",
  "think", "remember", "tell", "story", "happen", "happened", "happens",
]);

// Possessives and contractions ("puppy's", "kids'", "didn't") read oddly as
// a word to practice, so skip anything with an apostrophe.
const hasApostrophe = (w: string) => w.includes("'");

// Simplified practice-word pick: the first meaningful word of the question,
// e.g. "What did the puppy find?" -> "puppy",
// "What was the puppy's adventure?" -> "adventure".
export function extractPracticeWord(question: string): string | null {
  // Curly apostrophes (from the LLM) count as apostrophes.
  const words = question.toLowerCase().replace(/[‘’]/g, "'").match(/[a-z']+/g) ?? [];
  return (
    words.find((w) => w.length >= 3 && !NON_KEYWORDS.has(w) && !hasApostrophe(w)) ?? null
  );
}

type ModalPhase =
  | "loading" // Generating TTS audio
  | "speaking" // Owl is speaking the prompt
  | "listening" // Waiting for user response
  | "feedback" // Showing result
  | "complete"; // Ready to dismiss

const MAX_ATTEMPTS = 2;

export default function EngagementModal({
  prompt,
  onDismiss: dismissModal,
  onPracticeWord,
}: EngagementModalProps) {
  // Every exit path goes through here so a finished comprehension check always
  // reports its practice word first.
  const onDismiss = useCallback(() => {
    if (prompt.type === "comprehension_check") {
      const word = extractPracticeWord(prompt.text);
      if (word) onPracticeWord?.(word);
    }
    dismissModal();
  }, [prompt.type, prompt.text, onPracticeWord, dismissModal]);

  const [phase, setPhase] = useState<ModalPhase>("loading");
  const [attempts, setAttempts] = useState(0);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [isCorrect, setIsCorrect] = useState(false);
  const [showHint, setShowHint] = useState(false);

  // Guard against React Strict Mode double-execution
  const hasStartedRef = useRef(false);

  const { isLoading, isSpeaking, playPrompt, error: audioError } = usePromptAudio();
  const {
    isListening,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
    resetTranscript,
    isSupported: speechSupported,
    error: speechError,
  } = useSpeechRecognition();

  // Choose owl emotion based on phase and prompt type
  const getOwlEmotion = () => {
    if (phase === "feedback") {
      return isCorrect ? "excited" : "happy";
    }
    return prompt.type === "sound_cue" ? "excited" : "happy";
  };

  // Choose title based on phase and prompt type
  const getTitle = () => {
    if (phase === "loading") return "Getting ready...";
    if (phase === "listening") return "I'm listening...";
    if (phase === "feedback") {
      return isCorrect ? "Great job!" : "Good try!";
    }
    return {
      sound_cue: "Get Ready!",
      reading_prompt: "Think About It!",
      comprehension_check: "Quick Question!",
    }[prompt.type];
  };

  // Check if this prompt type needs voice interaction
  // Note: speechSupported may be false on initial render, so we also check directly in startFlow
  const needsListening = prompt.type === "comprehension_check" && speechSupported;

  // Start the voice interaction flow when modal mounts
  useEffect(() => {
    // Guard against React Strict Mode double-execution
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    const startFlow = async () => {
      // Check speech support directly here since speechSupported may not be set yet
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = typeof window !== "undefined" ? (window as any) : null;
      const hasSpeechSupport = !!(win?.SpeechRecognition || win?.webkitSpeechRecognition);
      const shouldListen = prompt.type === "comprehension_check" && hasSpeechSupport;

      console.log("[EngagementModal] Starting flow");
      console.log("[EngagementModal] Prompt type:", prompt.type);
      console.log("[EngagementModal] Speech support:", hasSpeechSupport);
      console.log("[EngagementModal] Should listen:", shouldListen);

      try {
        // Play the prompt audio
        console.log("[EngagementModal] Playing prompt audio...");
        await playPrompt(prompt.text);
        console.log("[EngagementModal] Prompt audio finished");

        // After speaking, transition to next phase
        if (shouldListen) {
          console.log("[EngagementModal] Transitioning to listening phase");
          setPhase("listening");
          startListening();
        } else {
          console.log("[EngagementModal] Transitioning to complete phase (no listening)");
          setPhase("complete");
        }
      } catch (err) {
        console.error("[EngagementModal] Error playing prompt:", err);
        // If TTS fails, skip to appropriate phase
        if (shouldListen) {
          setPhase("listening");
          startListening();
        } else {
          setPhase("complete");
        }
      }
    };

    startFlow();

    // Cleanup
    return () => {
      stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update phase based on audio state
  useEffect(() => {
    if (isLoading) {
      setPhase("loading");
    } else if (isSpeaking) {
      setPhase("speaking");
    }
  }, [isLoading, isSpeaking]);

  // Handle speech recognition result
  useEffect(() => {
    if (transcript && phase === "listening" && prompt.answer_hint) {
      stopListening();

      const result = validateAnswer(transcript, prompt.answer_hint);

      if (result.isCorrect) {
        setIsCorrect(true);
        setFeedbackMessage("You got it right!");
        setPhase("feedback");

        // Auto-dismiss after showing success
        setTimeout(() => {
          onDismiss();
        }, 2000);
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);

        if (newAttempts >= MAX_ATTEMPTS) {
          // Show the answer after max attempts
          setIsCorrect(false);
          setFeedbackMessage(`The answer was: ${prompt.answer_hint}`);
          setPhase("feedback");
        } else {
          // Allow retry
          setFeedbackMessage("Try again!");
          resetTranscript();
          setTimeout(() => {
            startListening();
          }, 1500);
        }
      }
    }
  }, [transcript, phase, prompt.answer_hint, attempts, stopListening, resetTranscript, startListening, onDismiss]);

  // Handle listening timeout (no speech detected)
  useEffect(() => {
    if (phase === "listening" && !isListening && !transcript && speechError === null) {
      // Speech recognition ended without result - might be timeout
      // Allow manual retry via button
    }
  }, [phase, isListening, transcript, speechError]);

  // Manual retry for listening
  const handleRetryListening = useCallback(() => {
    resetTranscript();
    startListening();
    setPhase("listening");
  }, [resetTranscript, startListening]);

  // Skip voice interaction (fallback)
  const handleSkip = useCallback(() => {
    stopListening();
    setPhase("complete");
  }, [stopListening]);

  // Choose accent color based on prompt type
  const accentColor = {
    sound_cue: "bg-accent-coral",
    reading_prompt: "bg-accent-teal",
    comprehension_check: "bg-accent-yellow",
  }[prompt.type];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal Card */}
      <div className="relative bg-surface-elevated rounded-3xl shadow-2xl max-w-md w-full p-8 text-center">
        {/* Owl Avatar */}
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 relative">
            <OwlAvatar
              emotion={getOwlEmotion()}
              speaking={phase === "speaking"}
              listening={phase === "listening"}
              className="!static !translate-x-0 !translate-y-0 !left-auto !bottom-auto"
            />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-extrabold text-ink-dark mb-4">{getTitle()}</h2>

        {/* Phase-specific content */}
        {phase === "loading" && (
          <div className="flex items-center justify-center gap-2 mb-6">
            <div className="animate-spin h-5 w-5 border-2 border-accent-teal border-t-transparent rounded-full" />
            <span className="text-gray-500">Preparing...</span>
          </div>
        )}

        {(phase === "speaking" || phase === "complete") && (
          <p className="text-xl text-gray-700 leading-relaxed mb-6">{prompt.text}</p>
        )}

        {phase === "listening" && (
          <>
            <p className="text-xl text-gray-700 leading-relaxed mb-4">{prompt.text}</p>

            {/* Listening indicator */}
            <div className="flex flex-col items-center gap-3 mb-6">
              <div className="flex items-center gap-2 text-accent-teal">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-8 h-8 animate-pulse"
                >
                  <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
                  <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-7.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z" />
                </svg>
                <span className="text-lg font-semibold">
                  {isListening ? "Listening..." : "Tap microphone to speak"}
                </span>
              </div>

              {/* Show interim transcript */}
              {interimTranscript && (
                <p className="text-sm text-gray-400 italic">"{interimTranscript}"</p>
              )}

              {/* Feedback message (try again) */}
              {feedbackMessage && !isCorrect && (
                <p className="text-accent-coral font-semibold">{feedbackMessage}</p>
              )}

              {/* Speech error */}
              {speechError && (
                <p className="text-sm text-red-500">{speechError}</p>
              )}

              {/* Manual retry button if not listening */}
              {!isListening && (
                <button
                  onClick={handleRetryListening}
                  className="mt-2 px-4 py-2 bg-accent-teal text-white rounded-full font-semibold text-sm hover:opacity-90 transition-all"
                >
                  Tap to speak
                </button>
              )}
            </div>

            {/* Skip button for accessibility */}
            <button
              onClick={handleSkip}
              className="text-sm text-gray-400 hover:text-gray-600 underline"
            >
              Skip voice answer
            </button>
          </>
        )}

        {phase === "feedback" && (
          <>
            <div className="mb-6">
              {isCorrect ? (
                <div className="flex items-center justify-center gap-2 text-green-600">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-8 h-8"
                  >
                    <path
                      fillRule="evenodd"
                      d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-xl font-bold">{feedbackMessage}</span>
                </div>
              ) : (
                <p className="text-lg text-gray-600">{feedbackMessage}</p>
              )}
            </div>

            {/* Continue button after feedback */}
            {!isCorrect && (
              <button
                onClick={onDismiss}
                className={`${accentColor} text-white px-8 py-3 rounded-full font-bold text-lg hover:opacity-90 transition-all transform hover:scale-105 shadow-lg`}
              >
                Continue
              </button>
            )}
          </>
        )}

        {phase === "complete" && (
          <>
            {/* Answer Hint (for comprehension checks without voice) */}
            {prompt.type === "comprehension_check" && prompt.answer_hint && !speechSupported && (
              <div className="mb-6">
                {showHint ? (
                  <p className="text-sm text-gray-500 bg-gray-100 rounded-lg p-3">
                    <span className="font-semibold">Answer:</span> {prompt.answer_hint}
                  </p>
                ) : (
                  <button
                    onClick={() => setShowHint(true)}
                    className="text-sm text-gray-400 hover:text-gray-600 underline"
                  >
                    Show answer (for grown-ups)
                  </button>
                )}
              </div>
            )}

            {/* Dismiss Button */}
            <button
              onClick={onDismiss}
              className={`${accentColor} text-white px-8 py-3 rounded-full font-bold text-lg hover:opacity-90 transition-all transform hover:scale-105 shadow-lg`}
            >
              {prompt.type === "sound_cue"
                ? "I'm Ready!"
                : prompt.type === "reading_prompt"
                  ? "Continue"
                  : "Got It!"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
