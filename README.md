# NarrateMe

**Turn a written story into a narrated, illustrated, multi-scene presentation — automatically, in under a minute.**

NarrateMe helps teachers and parents of kids in grades 1–3 turn any plain written story into an engaging, illustrated, narrated presentation, without needing any design, illustration, or audio-production skills. Paste a story in, and NarrateMe splits it into scenes, illustrates each one, narrates it with a warm voice, and plays it back as a simple, read-along presentation.

---

## Status

**MVP Sprint v1 — 2-week build.** This is a proof-of-concept build meant to demo the core pipeline end-to-end. It is not a production product. See [Non-Goals](#non-goals-v1) below for what's intentionally out of scope right now.

### Implementation Status

**Working today:**
- Story input UI — paste/type, sample stories, 50–3,000 character limits
- Scene splitting via Claude → structured JSON with a persistent character description reused across scenes
- Per-scene illustration via an OpenAI image model, using the shared character prompt for consistency
- Per-scene narration via ElevenLabs, returned as an inline audio player on each scene card
- Concurrent generation — images and narration each run through a bounded worker pool (max 2 in flight) with a per-scene retry and a visible error state on final failure
- Presentation player — scene cards (illustration + text + narration audio), Previous/Next navigation, live image and narration progress
- Word highlighting synced to narration audio (via ElevenLabs character-level timestamps)
- Owl avatar narrator synced to audio playback with emotion-based expressions
- Auto-advance "Play story" mode — plays through all scenes hands-free
- Pre-generated backup story for demo resilience
- Engagement prompts for active listening:
  - Sound cues before scenes ("Clap when you hear...")
  - Reading prompts after scenes ("What do you think happens next?")
  - Comprehension checks with answer hints for grown-ups
- Content safety guardrails — softens mature content for young readers or blocks unsuitable stories
- PIN-gated parent settings — content level, auto-play, and engagement prompts behind a 4-digit PIN so children can't change their own safety limits
- Owl mentor voice — engagement prompts use a distinct British voice (George) separate from the narrator (Sarah)
- Speech recognition for comprehension checks — children can answer questions by speaking
- Mock profile menu — owl avatar in header opens an account menu (UI only, no auth)
- Backend hardening — request timeouts (60s scenes / 120s images / 60s narration), structured logging, API-key validation, `504` on timeout

**Known gap:** OpenAI's per-image latency is highly variable (~40s nominal, but can climb past the 120s backend timeout under throttling). Generation is concurrent (capped at 2 in flight), so total time scales with the slowest image rather than the sum; a slow outlier returns `504`, after which the frontend retries once and, if that also fails, shows a per-scene error card.

---

## Team

| Name | Role |
|---|---|
| Erasmo Concepcion | Backend/AI Engineer |
| Christina Ruiz | AI/Visual Engineer |
| Richard Theard | Frontend/UX Lead |

---

## How It Works

1. **Input** — User pastes or types a story into a text box. No login required.
2. **Scene splitting** — An LLM (Claude/GPT) splits the story into 3–5 scenes (beginning/middle/end structure) and outputs structured JSON, including a persistent character description reused across every scene.
3. **Illustration** — an OpenAI image model (`gpt-image-2`) generates one illustration per scene, using the shared character description to keep the character visually consistent.
4. **Narration** — ElevenLabs generates narration audio per scene using a warm voice ("Sarah") suited to early readers, returned as a base64 MP3 and played inline on each scene card.
5. **Playback** — A presentation player shows each scene's illustration alongside its text and a narration audio player, with word-by-word highlighting synced to narration. An owl avatar narrator reacts with emotion-based expressions. "Play story" mode auto-advances through all scenes hands-free.
6. **Engagement** — 2–3 engagement prompts per story turn passive listeners into active participants: sound cues before scenes, reading prompts and comprehension checks after scenes.

---

## Tech Stack

| Layer | Tool |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| Backend / Orchestration | Python (FastAPI), Uvicorn, async clients |
| Scene generation | Anthropic Claude (structured JSON output) |
| Image generation | OpenAI image model (returns base64 PNG) |
| Text-to-Speech | ElevenLabs (`AsyncElevenLabs`, returns base64 MP3) |
| Avatar | Owl narrator with 5 emotion-based expressions (happy, sad, excited, scared, calm) |
| Hosting | Vercel (frontend) + Railway (backend) |
| Storage | None required for MVP — stateless, one-shot generation |

---

## Getting Started

### Backend (FastAPI)

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows  (use: source venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
```

Create `backend/.env`:

```
API_KEY=your_anthropic_api_key
OPENAI_API_KEY=your_openai_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
```

Run the API (serves on `http://localhost:8000`):

```bash
uvicorn app.main:app --reload --port 8000
```

**Endpoints:** `GET /health`, `POST /api/scenes` (split story → scenes), `POST /api/images` (prompt → illustration), `POST /api/audio` (text → narration MP3).

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The frontend defaults to the backend at
`http://localhost:8000`. To point it elsewhere, copy `frontend/.env.example` to
`frontend/.env.local` and set `NEXT_PUBLIC_API_URL`.

---

## Deployment

The two halves deploy separately: the FastAPI backend to **Railway** (an always-on
server host — the image/narration calls run 50–120s, so serverless platforms with short
request limits won't work), and the Next.js frontend to **Vercel**. Deploy the backend
first so you have its URL for the frontend.

### 1. Backend → Railway

1. Create a new Railway project → **Deploy from GitHub repo** and select this repo.
2. In the service **Settings**, set **Root Directory** to `backend` (the app lives in a
   subdirectory).
3. Railway (Nixpacks) auto-detects `requirements.txt`. Set the **Start Command** to:
   ```
   uvicorn app.main:app --host 0.0.0.0 --port $PORT
   ```
   Railway injects `$PORT`; binding `0.0.0.0` is required.
4. Add environment variables (**Variables** tab):
   - `API_KEY` — Anthropic API key (scene splitting)
   - `OPENAI_API_KEY` — OpenAI key (image generation)
   - `ELEVENLABS_API_KEY` — ElevenLabs key (narration)
   - *(optional)* `IMAGE_QUALITY` (`low`/`medium`/`high`, default `medium`) and
     `IMAGE_SIZE` (default `1024x1024`)
   - Leave `CORS_ORIGINS` unset for now (added in step 3 below).
   - *(optional)* pin Python via a `.python-version` file or `NIXPACKS_PYTHON_VERSION`;
     the default recent Python (3.11+) works for this code.
5. Deploy, then verify: open `https://<your-railway-domain>/health` — it should return
   `{"status":"healthy"}`.

### 2. Frontend → Vercel

1. Import the repo into Vercel and set **Root Directory** to `frontend` (Vercel
   auto-detects Next.js).
2. Add an environment variable:
   - `NEXT_PUBLIC_API_URL` = your Railway backend URL (e.g.
     `https://<your-railway-domain>`)
   - `NEXT_PUBLIC_` vars are inlined at **build time**, so set this before deploying (or
     redeploy after changing it).
3. Deploy, and note the resulting Vercel URL (e.g. `https://narrateme.vercel.app`).

### 3. Close the CORS loop

1. Back in Railway, set `CORS_ORIGINS` to your Vercel production URL
   (e.g. `https://narrateme.vercel.app`) and redeploy the backend.
   - Multiple origins are comma-separated. Vercel *preview* deploys get dynamic URLs; to
     allow those too you'd switch to `allow_origin_regex` in `backend/app/main.py` — the
     production URL alone is fine for a demo.

### 4. Smoke test

Load the Vercel site, paste a story, and confirm images and narration generate with no
CORS errors in the browser console.

---

## MVP Scope (Must Have) ✅

- ✅ Text input only (no speech-to-text)
- ✅ LLM scene splitting into 5 scenes
- ✅ One illustration per scene (OpenAI image model, consistent character prompt)
- ✅ TTS narration per scene with word-level timestamps
- ✅ Presentation player (image + highlighted text + auto-advance)
- ✅ Owl avatar with emotion-based expressions
- ✅ Engagement prompts for active listening
- ✅ Content safety guardrails

## Non-Goals (v1)

- Lip-sync / gesture animation
- Advanced comprehension quizzes with scoring (basic comprehension checks are implemented)
- Vocabulary activities
- Teacher dashboard, analytics, or story library
- Background music
- Speech-to-text / audio story input
- Multi-language support

---

## Success Criteria (Demo-Ready)

- A teacher/parent can paste a story and get a playable illustrated + narrated presentation in under 60 seconds.
- The pipeline completes without manual intervention on at least 2 different test stories.
- Word highlighting stays roughly in sync with narration.
- A backup pre-generated story is ready in case live generation fails during the demo.
- Engagement prompts (2–3 per story) display correctly and pause/resume auto-advance.

---

## Known Risk

**Character consistency across scenes** — generated illustrations may drift in the character's appearance between scenes. Mitigation for this build is a strong, persistent character-description prompt reused in every image generation call — not a technical/model-level fix. This is flagged as future work rather than solved in the 2-week build.

---

## Timeline (14 Days)

| Days | Milestone |
|---|---|
| 1–2 | Finalize scope, set up repo/API keys, each person validates their API call in isolation |
| 3–7 | Parallel build: pipeline (backend), image gen (AI), TTS (audio), player UI (frontend, against mock data) |
| 8–10 | Integration: connect pipeline end-to-end, add error/timeout handling |
| 11–12 | Polish: word-highlight sync, transitions, loading states, 1–2 pre-generated backup stories |
| 13–14 | Buffer + demo rehearsal |

---

## Future Scope (Post-Sprint)

Avatar lip-sync, advanced comprehension quizzes with scoring, vocabulary activities, teacher dashboard, story library, voice cloning, multi-language support, background music/sound design, analytics.
