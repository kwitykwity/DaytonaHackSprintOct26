"use client";

import Image from "next/image";
import Link from "next/link";
import { Fragment, useState, useEffect, useRef, useSyncExternalStore } from "react";
import OwlAvatar from "./OwlAvatar";
import EngagementModal from "./EngagementModal";
import WelcomeMessage from "./WelcomeMessage";
import { type ReaderSession, getReaderName, postReaderSession } from "../lib/reader";
import { DEFAULT_SETTINGS, loadParentSettings } from "../lib/parentSettings";

// First ~50 characters of the story for the owl's "last time we read about..."
// line, cut back to a word boundary so it doesn't end mid-word.
function storySnippet(text: string, maxLength = 50): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.!?-]+$/, "");
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Used with useSyncExternalStore to detect client-side hydration without
// triggering a setState-in-effect (sessionStorage is client-only).
const emptySubscribe = () => () => {};

// Resolve after `ms`, or early if `signal` aborts, so a pending retry backoff
// doesn't outlive an unmount.
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

// One word's playback window (seconds), from ElevenLabs' character alignment,
// used to highlight the word as the narration reaches it.
interface WordTiming {
  word: string;
  start: number;
  end: number;
}

// Engagement prompt to make children active listeners
interface EngagementPrompt {
  type: "reading_prompt" | "sound_cue" | "comprehension_check";
  text: string;
  timing: "before" | "after";
  answer_hint?: string;
}

interface Scene {
  scene_number: number;
  text: string;
  // Present for live-generated scenes (from /api/scenes); absent for the
  // pre-baked backup story, whose images are already rendered.
  image_prompt?: string;
  image_url?: string;
  image_error?: boolean;
  audio_url?: string;
  audio_error?: boolean;
  word_timings?: WordTiming[];
  // Dominant tone tagged for this scene (happy/sad/excited/scared/calm), used to
  // pick the owl narrator's expression. Falls back to a default owl if absent.
  emotion?: string;
  // Optional engagement prompt for active listening
  engagement?: EngagementPrompt;
}

// Max requests in flight at once, per resource. High concurrency inflates the
// image API's per-request latency (and can trip the backend timeout), so we cap
// it. Narration is capped at 2 to match the ElevenLabs free-tier concurrent
// request limit (3+ in parallel returns 429 concurrent_limit_exceeded).
const IMAGE_CONCURRENCY = 2;
const AUDIO_CONCURRENCY = 2;

// Total attempts per scene resource before giving up. Failures are usually
// transient (upstream timeouts under load), so a retry often recovers them.
const IMAGE_MAX_ATTEMPTS = 2;
const AUDIO_MAX_ATTEMPTS = 2;

// Per-attempt client-side ceiling (ms). A request that hasn't resolved by then
// is aborted and counted as a failed attempt (then retried). Set above the
// backend's own timeouts so its structured 504/429 responses are preferred,
// leaving this as a backstop for a truly hung request. Images are the slow one.
const IMAGE_TIMEOUT_MS = 130_000;
const AUDIO_TIMEOUT_MS = 65_000;

// Base delay before retrying a failed request, scaled by attempt number. Images
// fail mainly under upstream load, so pausing lets it subside before retrying;
// narration is fast and reliable, so it retries immediately (0).
const IMAGE_RETRY_BACKOFF_MS = 3_000;
const AUDIO_RETRY_BACKOFF_MS = 0;

interface ScenesData {
  character_description: string;
  scenes: Scene[];
  // Content-safety guardrail verdict from /api/scenes. When the story is too
  // intense to soften for young readers the backend returns 200 with
  // blocked: true, an empty scenes list, and a kid-safe explanation for the
  // grown-up in block_reason.
  blocked?: boolean;
  block_reason?: string;
}

// Shape of the pre-baked backup manifest at /public/demo-story.json. Its scenes
// already carry rendered image/audio URLs (static /demo/* paths), so no live
// generation is needed once it's loaded.
interface BackupStory {
  title: string;
  scenes: {
    scene_number: number;
    text: string;
    image_url: string;
    audio_url: string;
    word_timings?: WordTiming[];
    emotion?: string;
    engagement?: EngagementPrompt;
  }[];
}

// Load the pre-generated backup story and adapt it to the ScenesData shape the
// player already renders. Used as a fallback when live generation can't produce
// anything (e.g. the scene-split call fails during a demo).
async function loadBackupStory(signal?: AbortSignal): Promise<ScenesData> {
  const res = await fetch("/demo-story.json", signal ? { signal } : undefined);
  if (!res.ok) {
    throw new Error("Failed to load backup story");
  }
  const data: BackupStory = await res.json();
  return {
    character_description: "",
    scenes: data.scenes.map((s) => ({
      scene_number: s.scene_number,
      text: s.text,
      image_url: s.image_url,
      audio_url: s.audio_url,
      word_timings: s.word_timings,
      emotion: s.emotion,
      engagement: s.engagement,
    })),
  };
}

function PresentationContent() {
  // false during SSR and the first hydration render, true once on the client.
  const hydrated = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const story = hydrated ? sessionStorage.getItem("narrateme:story") : null;
  // Parent-controlled settings (safety level + playback), set behind the PIN
  // gate. Read on the client only; defaults stand in during SSR.
  const parentSettings = hydrated ? loadParentSettings() : DEFAULT_SETTINGS;
  const contentLevel = parentSettings.contentLevel;

  const [status, setStatus] = useState<"loading" | "generating" | "done" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [scenesData, setScenesData] = useState<ScenesData | null>(null);
  // Set when the content-safety guardrail withholds the story. Holds the
  // grown-up-facing reason so we can show a gentle notice instead of a
  // presentation (the response carries no scenes to render).
  const [blockReason, setBlockReason] = useState<string | null>(null);
  const [usedBackupStory, setUsedBackupStory] = useState(false);
  const [liveGenerationStatus, setLiveGenerationStatus] = useState<"checking" | "ready" | "limited">("checking");
  // True once we've fallen back to the pre-baked backup story instead of live
  // generation, so the UI can flag it.
  const [isBackup, setIsBackup] = useState(false);
  const [currentScene, setCurrentScene] = useState(0);
  // When true, each scene's narration plays automatically and advances to the
  // next scene when the audio ends (hands-free read-along).
  // Read-along state. The parent's "play automatically" setting supplies the
  // starting value and the reader's Play/Pause overrides it, so this is derived
  // rather than synced from the setting in an effect.
  const [autoAdvanceOverride, setAutoAdvance] = useState<boolean | null>(null);
  const autoAdvance = autoAdvanceOverride ?? parentSettings.autoPlay;
  // Index of the word currently being narrated in the active scene (-1 = none),
  // driven by the audio element's timeupdate events.
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // The <audio> element is keyed by scene, so React mounts a fresh one each
  // scene which would otherwise reset to full volume. Remember the reader's
  // chosen volume/mute and reapply it to each new element.
  const volumeRef = useRef(1);
  const mutedRef = useRef(false);
  // Engagement prompt state - shows modal for active listening prompts
  const [showingPrompt, setShowingPrompt] = useState(false);
  const [pendingAdvance, setPendingAdvance] = useState(false);
  // Track which scenes have shown their "before" prompt to avoid re-showing
  const shownBeforePrompts = useRef<Set<number>>(new Set());
  // Memory Owl: the practice word from the latest comprehension check, and
  // whether this story's session has been saved. Refs rather than state because
  // the word is reported and the story can finish in the same tick.
  const practiceWordRef = useRef<string | null>(null);
  const sessionSavedRef = useRef(false);

  // Check for "before" engagement prompts when scene changes.
  // Pause any playing audio immediately when showing a prompt.
  useEffect(() => {
    if (!scenesData) return;
    // A grown-up can turn prompts off in Parent settings.
    if (!parentSettings.engagementPrompts) return;
    const engagement = scenesData.scenes[currentScene]?.engagement;
    if (
      engagement?.timing === "before" &&
      !shownBeforePrompts.current.has(currentScene)
    ) {
      shownBeforePrompts.current.add(currentScene);
      // Pause audio immediately - the state update won't take effect until next render,
      // so we need to pause directly to prevent audio playing behind the prompt.
      audioRef.current?.pause();
      setShowingPrompt(true);
    }
  }, [currentScene, scenesData, parentSettings.engagementPrompts]);

  // Ensure audio is always paused when any prompt is showing.
  // This catches edge cases where audio might still be playing.
  useEffect(() => {
    if (showingPrompt) {
      audioRef.current?.pause();
    }
  }, [showingPrompt]);

  useEffect(() => {
    if (!story) return;

    const controller = new AbortController();
    let cancelled = false;

    async function generatePresentation() {
      try {
        const healthRes = await fetch(`${API_URL}/health`);
        if (healthRes.ok) {
          const health = await healthRes.json();
          const services = health.ai_services ?? {};
          const configured = Object.values(services).filter((service: any) => service?.configured).length;
          setLiveGenerationStatus(configured === 3 ? "ready" : "limited");
        }

        // Step 1: Split story into scenes
        setStatus("loading");
        const scenesRes = await fetch(`${API_URL}/api/scenes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ story, content_level: contentLevel }),
          signal: controller.signal,
        });

        if (!scenesRes.ok) {
          throw new Error("Failed to split story into scenes");
        }

        const data: ScenesData = await scenesRes.json();
        if (cancelled) return;

        // Content-safety guardrail withheld the story: a 200 carrying no scenes.
        // Show the notice instead of generating (and instead of falling back to
        // the backup story — the block is a deliberate verdict, not a failure).
        if (data.blocked) {
          setBlockReason(
            data.block_reason?.trim() ||
              "This story isn't a good fit for young readers. Try a gentler one."
          );
          setStatus("done");
          return;
        }

        setScenesData(data);
        setStatus("generating");

        // Functional updates so concurrent per-scene writes (image + narration)
        // don't clobber each other.
        const patchScene = (i: number, patch: Partial<Scene>) =>
          setScenesData((prev) => {
            if (!prev) return prev;
            const scenes = [...prev.scenes];
            scenes[i] = { ...scenes[i], ...patch };
            return { ...prev, scenes };
          });

        // Fetch one resource (image or narration) for a scene, retrying on
        // failure. While retrying the scene keeps showing its loading state;
        // only the final failure applies the error patch.
        async function fetchWithRetry(
          endpoint: string,
          body: object,
          maxAttempts: number,
          timeoutMs: number,
          retryBackoffMs: number,
          label: string,
          sceneNumber: number,
          onSuccess: (json: Record<string, unknown>) => void,
          onFinalError: () => void
        ) {
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (cancelled) return;
            try {
              const res = await fetch(`${API_URL}${endpoint}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                // Abort if the caller cancels (unmount) or the per-attempt
                // timeout elapses. A timeout throws a TimeoutError (not
                // AbortError), so it falls through to the retry path below
                // instead of the silent-cancellation guard.
                signal: AbortSignal.any([
                  controller.signal,
                  AbortSignal.timeout(timeoutMs),
                ]),
              });
              if (cancelled) return;
              if (!res.ok) {
                throw new Error(`${res.status} ${res.statusText}`);
              }
              const json = await res.json();
              if (cancelled) return;
              onSuccess(json);
              return;
            } catch (err) {
              if (cancelled) return;
              // Intentional cancellation: stop silently.
              if (err instanceof DOMException && err.name === "AbortError") return;
              const lastAttempt = attempt === maxAttempts;
              console.error(
                `${label} for scene ${sceneNumber} failed on attempt ` +
                  `${attempt}/${maxAttempts}` +
                  `${lastAttempt ? " (giving up)" : ", retrying"}:`,
                err
              );
              if (lastAttempt) {
                onFinalError();
              } else if (retryBackoffMs > 0) {
                // Scale the pause with the attempt number, then re-check
                // cancellation since the wait can span an unmount.
                await delay(retryBackoffMs * attempt, controller.signal);
                if (cancelled) return;
              }
            }
          }
        }

        // Run a bounded worker pool over the scenes: workers pull the next
        // scene index off a shared cursor, keeping at most `concurrency`
        // requests in flight. Cards fill in as each resolves.
        const runPool = (
          concurrency: number,
          task: (scene: Scene, i: number) => Promise<void>
        ) => {
          let nextIndex = 0;
          async function worker() {
            while (!cancelled) {
              const i = nextIndex++;
              if (i >= data.scenes.length) return;
              await task(data.scenes[i], i);
            }
          }
          return Promise.all(
            Array.from({ length: Math.min(concurrency, data.scenes.length) }, worker)
          );
        };

        // Step 2: Generate images and narration concurrently, each with its own
        // bounded pool so slow images don't hold up the (fast) narration.
        await Promise.all([
          runPool(IMAGE_CONCURRENCY, (scene, i) =>
            fetchWithRetry(
              "/api/images",
              { prompt: scene.image_prompt },
              IMAGE_MAX_ATTEMPTS,
              IMAGE_TIMEOUT_MS,
              IMAGE_RETRY_BACKOFF_MS,
              "Image generation",
              scene.scene_number,
              (json) => patchScene(i, { image_url: json.image_url as string, image_error: false }),
              () => patchScene(i, { image_error: true })
            )
          ),
          runPool(AUDIO_CONCURRENCY, (scene, i) =>
            fetchWithRetry(
              "/api/audio",
              { text: scene.text },
              AUDIO_MAX_ATTEMPTS,
              AUDIO_TIMEOUT_MS,
              AUDIO_RETRY_BACKOFF_MS,
              "Narration generation",
              scene.scene_number,
              (json) =>
                patchScene(i, {
                  audio_url: json.audio_url as string,
                  word_timings: json.word_timings as WordTiming[],
                  audio_error: false,
                }),
              () => patchScene(i, { audio_error: true })
            )
          ),
        ]);

        if (cancelled) return;
        setStatus("done");
      } catch (err) {
        if (cancelled) return;
        // Intentional cancellation (StrictMode remount / unmount): stay silent.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Live generation failed before we could show anything (for example,
        // because the AI services are not configured locally). Fall back to the
        // bundled backup story so the demo still plays.
        try {
          const backup = await loadBackupStory(controller.signal);
          if (cancelled) return;
          setScenesData(backup);
          setIsBackup(true);
          setUsedBackupStory(true);
          setStatus("done");
        } catch {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "Something went wrong");
          setStatus("error");
        }
      }
    }

    generatePresentation();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [story, contentLevel]);

  // Drive the read-along: when auto-advance is on and the current scene's
  // narration is ready, play it. Changing scene (or a newly-arrived audio URL)
  // re-triggers this so the next clip starts automatically.
  // Don't play while an engagement prompt is showing - wait for it to be dismissed.
  // Also check for unseen "before" prompts directly (not just state) to handle
  // the race condition where both effects run in the same render cycle.
  const currentAudioUrl = scenesData?.scenes[currentScene]?.audio_url;
  useEffect(() => {
    if (!autoAdvance || showingPrompt) return;
    // Check if this scene has a "before" prompt we haven't shown yet
    const engagement = scenesData?.scenes[currentScene]?.engagement;
    const hasUnseenBeforePrompt =
      // With prompts switched off none will ever show, so waiting on one here
      // would stall playback forever.
      parentSettings.engagementPrompts &&
      engagement?.timing === "before" &&
      !shownBeforePrompts.current.has(currentScene);
    if (hasUnseenBeforePrompt) return;
    const el = audioRef.current;
    if (el && currentAudioUrl) {
      // Autoplay can be rejected without a prior user gesture; ignore it.
      el.play().catch(() => {});
    }
  }, [
    autoAdvance,
    currentScene,
    currentAudioUrl,
    showingPrompt,
    scenesData,
    parentSettings.engagementPrompts,
  ]);


  // Reapply the remembered volume/mute to the freshly-mounted audio element so
  // the reader's setting carries across scenes instead of resetting to full.
  useEffect(() => {
    const el = audioRef.current;
    if (el) {
      el.volume = volumeRef.current;
      el.muted = mutedRef.current;
    }
  }, [currentScene, currentAudioUrl]);

  // Move to another scene, clearing the word highlight; the new scene's audio
  // element remounts at time 0 and its timeupdate events drive it again.
  const goToScene = (updater: (c: number) => number) => {
    setCurrentScene(updater);
    setCurrentWordIndex(-1);
  };

  // Manual escape hatch: load the backup story on demand (e.g. from the error
  // screen if the automatic fallback's own fetch failed and was retried).
  const showBackup = async () => {
    setStatus("loading");
    try {
      const backup = await loadBackupStory();
      setScenesData(backup);
      setIsBackup(true);
      setUsedBackupStory(true);
      setCurrentScene(0);
      setCurrentWordIndex(-1);
      setStatus("done");
    } catch {
      setError("Couldn't load the backup story");
      setStatus("error");
    }
  };

  if (hydrated && !story) {
    return (
      <div className="text-center">
        <p className="text-zinc-600 dark:text-zinc-400 mb-4">No story provided</p>
        <Link href="/" className="text-blue-600 hover:underline dark:text-blue-400">
          Go back and enter a story
        </Link>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="text-center">
        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={showBackup}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
          >
            Show the backup story
          </button>
          <Link href="/" className="text-blue-600 hover:underline dark:text-blue-400">
            Try again
          </Link>
        </div>
      </div>
    );
  }

  // Content-safety guardrail withheld the story. There are no scenes to play,
  // so this replaces the presentation with a gentle explanation for the adult.
  if (blockReason) {
    return (
      <div className="w-full max-w-xl">
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-8 text-center dark:border-amber-700 dark:bg-amber-950">
          <p className="mb-2 text-lg font-semibold text-amber-800 dark:text-amber-300">
            Let&apos;s pick a different story
          </p>
          <p className="mb-6 text-amber-700 dark:text-amber-400">{blockReason}</p>
          <Link
            href="/"
            className="inline-block rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700"
          >
            Try another story
          </Link>
        </div>
      </div>
    );
  }

  if (status === "loading" || !scenesData) {
    return (
      <div className="w-full max-w-3xl">
        <div className="flex items-center justify-center gap-3 p-12 bg-zinc-100 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>
          <p className="text-zinc-600 dark:text-zinc-400">Splitting story into scenes...</p>
        </div>
      </div>
    );
  }

  // Defense in depth: every render path below dereferences `scene` directly, so
  // an empty scene list would throw. The guardrail path above already handles
  // the known case (blocked stories return no scenes); this catches any other
  // way an empty list could reach here rather than crashing the player.
  if (scenesData.scenes.length === 0) {
    return (
      <div className="text-center">
        <p className="mb-4 text-zinc-600 dark:text-zinc-400">
          This story didn&apos;t produce any scenes.
        </p>
        <Link href="/" className="text-blue-600 hover:underline dark:text-blue-400">
          Try another story
        </Link>
      </div>
    );
  }

  const scene = scenesData.scenes[currentScene];
  const totalScenes = scenesData.scenes.length;
  const imagesLoaded = scenesData.scenes.filter((s) => s.image_url).length;
  const audioLoaded = scenesData.scenes.filter((s) => s.audio_url).length;
  const allImagesReady = imagesLoaded === totalScenes;

  // Read-along toggle. Starting/stopping is a user gesture, which satisfies
  // the browser autoplay policy for the subsequent auto-advanced clips.
  const toggleReadAlong = () => {
    if (autoAdvance) {
      setAutoAdvance(false);
      audioRef.current?.pause();
    } else {
      setAutoAdvance(true);
      audioRef.current?.play().catch(() => {});
    }
  };

  // Memory Owl: once the story is finished, remember it (and the practice word)
  // for this reader so the owl can bring it up next visit. Saves at most once
  // per story and fails silently if the backend is unavailable.
  const saveReaderSession = () => {
    if (sessionSavedRef.current) return;
    const name = getReaderName()?.trim();
    if (!name) return;
    sessionSavedRef.current = true;
    postReaderSession({
      name,
      story_snippet: storySnippet(scenesData.scenes[0].text),
      practice_word: practiceWordRef.current,
    }).then((saved) => {
      if (saved) console.log(`Session saved for ${name}`);
    });
  };

  // When a scene's narration finishes, clear the highlight; during read-along
  // When a scene's narration finishes, check for "after" engagement prompts.
  // If there's a prompt, show it and defer auto-advance until dismissed.
  // Otherwise, advance to the next scene or stop on the last scene.
  const handleAudioEnded = () => {
    setCurrentWordIndex(-1);

    // Check for "after" engagement prompt (unless a grown-up turned them off)
    const engagement = parentSettings.engagementPrompts ? scene?.engagement : undefined;
    if (engagement?.timing === "after") {
      setShowingPrompt(true);
      if (autoAdvance) {
        setPendingAdvance(true);
      }
      return;
    }

    // Last scene's narration done with no prompt after it: story complete.
    if (currentScene === totalScenes - 1) saveReaderSession();

    if (!autoAdvance) return;
    if (currentScene < totalScenes - 1) {
      setCurrentScene((c) => c + 1);
    } else {
      setAutoAdvance(false);
    }
  };

  // Follow narration playback: highlight the latest word whose start time has
  // been reached, so the highlight holds through short inter-word gaps until the
  // next word begins. Driven by the audio element's timeupdate events, so it
  // works for both read-along and manual play.
  const handleTimeUpdate = () => {
    const el = audioRef.current;
    const timings = scene.word_timings;
    if (!el || !timings || timings.length === 0) return;
    const t = el.currentTime;
    let idx = -1;
    for (let i = 0; i < timings.length; i++) {
      if (timings[i].start <= t) idx = i;
      else break;
    }
    setCurrentWordIndex(idx);
  };

  // Handle dismissing an engagement prompt.
  // - For "before" prompts: Start playing the current scene's audio
  // - For "after" prompts with autoAdvance: Advance to next scene
  const handlePromptDismiss = () => {
    const engagement = scene?.engagement;
    setShowingPrompt(false);

    // The last scene's "after" prompt is the final step of the story.
    if (engagement?.timing === "after" && currentScene === totalScenes - 1) {
      saveReaderSession();
    }

    if (engagement?.timing === "before") {
      // "Before" prompts block audio until dismissed - now play it
      audioRef.current?.play().catch(() => {});
    } else if (pendingAdvance) {
      // "After" prompts with autoAdvance - advance to next scene
      setPendingAdvance(false);
      if (currentScene < totalScenes - 1) {
        setCurrentScene((c) => c + 1);
      } else {
        setAutoAdvance(false);
      }
    }
  };

  return (
    <div className="w-full max-w-4xl">
      {liveGenerationStatus !== "ready" && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-400">
          {liveGenerationStatus === "limited"
            ? "Live generation is limited right now, so this demo is using the bundled backup story."
            : "Checking live generation availability…"}
        </div>
      )}

      {isBackup && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-400">
          Live generation is unavailable right now, so this demo is using the bundled backup story.
        </div>
      )}

      {status === "generating" && (
        <div className="mb-6 flex flex-col items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
          <div className="flex items-center gap-2">
            <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
            <span>
              Generating images ({imagesLoaded}/{totalScenes}) and narration (
              {audioLoaded}/{totalScenes})...
            </span>
          </div>
          {!allImagesReady && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              Play will be available once all images are ready
            </span>
          )}
        </div>
      )}

      {/* Scene Card */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden shadow-lg">
        {/* Image */}
        <div className="relative aspect-video bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
          {scene.image_url ? (
            <Image
              src={scene.image_url}
              alt={`Scene ${scene.scene_number}`}
              fill
              className="object-cover"
              unoptimized
            />
          ) : scene.image_error ? (
            <div className="flex flex-col items-center gap-2 px-6 text-center text-amber-600 dark:text-amber-500">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="h-8 w-8"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m0 3.75h.008M10.34 3.94l-8.14 14.1A1.5 1.5 0 003.5 20.25h17a1.5 1.5 0 001.3-2.21l-8.14-14.1a1.5 1.5 0 00-2.6 0z"
                />
              </svg>
              <span className="text-sm">
                Image couldn&apos;t be generated for this scene.
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-zinc-400">
              <div className="animate-spin h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full"></div>
              <span className="text-sm">Generating image...</span>
            </div>
          )}

          {/* Owl narrator: self-contained, fetches + draws itself from the
              scene's emotion. Mounted here so it sits at the image's bottom edge. */}
          <OwlAvatar emotion={scene.emotion} />
        </div>

        {/* Text */}
        <div className="px-6 pb-6 pt-14">
          <p className="text-base text-zinc-800 dark:text-zinc-200 leading-relaxed">
            {scene.word_timings && scene.word_timings.length > 0
              ? scene.word_timings.map((w, i) => (
                  <Fragment key={i}>
                    <span
                      className={
                        i === currentWordIndex
                          ? "rounded bg-amber-200 dark:bg-amber-400/30 transition-colors"
                          : "transition-colors"
                      }
                    >
                      {w.word}
                    </span>
                    {i < scene.word_timings!.length - 1 ? " " : ""}
                  </Fragment>
                ))
              : scene.text}
          </p>

          {/* Narration */}
          <div className="mt-4">
            {!allImagesReady ? (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                <span>Waiting for all images to generate...</span>
              </div>
            ) : scene.audio_url ? (
              <audio
                key={scene.scene_number}
                ref={audioRef}
                controls
                preload="auto"
                src={scene.audio_url}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleAudioEnded}
                onVolumeChange={(e) => {
                  volumeRef.current = e.currentTarget.volume;
                  mutedRef.current = e.currentTarget.muted;
                }}
                className="w-full"
              >
                Your browser does not support audio playback.
              </audio>
            ) : scene.audio_error ? (
              <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="h-5 w-5 shrink-0"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m0 3.75h.008M10.34 3.94l-8.14 14.1A1.5 1.5 0 003.5 20.25h17a1.5 1.5 0 001.3-2.21l-8.14-14.1a1.5 1.5 0 00-2.6 0z"
                  />
                </svg>
                <span>Narration couldn&apos;t be generated for this scene.</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                <span>Generating narration...</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Read-along control */}
      <div className="mt-6 flex justify-center">
        <button
          onClick={toggleReadAlong}
          disabled={!allImagesReady || audioLoaded === 0}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {autoAdvance ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
          <span>{autoAdvance ? "Pause" : "Play story"}</span>
        </button>
      </div>

      {/* Navigation */}
      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() => goToScene((c) => c - 1)}
          disabled={!allImagesReady || currentScene === 0}
          className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Previous
        </button>

        <span className="text-zinc-500 dark:text-zinc-400">
          {currentScene + 1} / {totalScenes}
        </span>

        <button
          onClick={() => goToScene((c) => c + 1)}
          disabled={!allImagesReady || currentScene === totalScenes - 1}
          className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next
        </button>
      </div>

      {/* Start over */}
      <div className="mt-8 text-center">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Start over with a new story
        </Link>
      </div>

      {/* Engagement Prompt Modal */}
      {showingPrompt && scene?.engagement && (
        <EngagementModal
          prompt={scene.engagement}
          onDismiss={handlePromptDismiss}
          onPracticeWord={(word) => {
            practiceWordRef.current = word;
          }}
        />
      )}
    </div>
  );
}

export default function PresentationPage() {
  // Memory Owl: who's reading and what the owl remembers from last time. Stays
  // null when no name was entered, so no greeting is shown.
  const [readerData, setReaderData] = useState<Omit<ReaderSession, "reader_id"> | null>(null);

  useEffect(() => {
    const name = getReaderName()?.trim();
    if (!name) return;
    let cancelled = false;
    // Empty story and word: this only looks the reader up; the backend leaves
    // what it remembered from their last story untouched.
    postReaderSession({ name, story_snippet: "", practice_word: null }).then((data) => {
      if (cancelled) return;
      // Backend unavailable: still greet the reader by name.
      setReaderData(data ?? { name, is_returning: false, previous_session: null });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 dark:bg-black px-4 py-12">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-white mb-2">
          NarrateMe
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">Your illustrated story</p>
      </div>

      {readerData && (
        <WelcomeMessage
          name={readerData.name}
          isReturning={readerData.is_returning}
          previousSession={readerData.previous_session}
        />
      )}

      <PresentationContent />
    </div>
  );
}
