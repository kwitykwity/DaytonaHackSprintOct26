# Memory Owl Feature - PRD
**Hackathon Sprint** | **Time Budget: 2 Hours** | **Sponsor: SurrealDB**

## 🎯 Goal
Add a "memory" feature where the owl narrator remembers returning kids and personalizes their experience.

## 🎬 The Demo Moment
```
FIRST VISIT:
User opens app → Modal: "Hi! What's your name?" → User enters "Emma"
User completes story about "The Lost Puppy"
Comprehension check: practices word "adventure"

SECOND VISIT:
User opens app → Owl says: "Welcome back, Emma! Last time you read about
'The Lost Puppy' and practiced the word 'adventure'. Ready for another story?"
```

## 📊 Success Criteria
- [ ] SurrealDB running and connected
- [ ] Name stored in database on first visit
- [ ] Previous session data retrieved on return visit
- [ ] Welcome-back message displays personalized info
- [ ] One practice word from comprehension check saved per session

---

## 👥 Team Assignments (3 People)

### 🔧 PERSON 1: Backend Engineer (60-70 min)
**Stack:** Python, FastAPI, SurrealDB

#### Task 1A: SurrealDB Setup (20 min)
**Acceptance Criteria:**
- [ ] SurrealDB running via Docker on `localhost:8000`
- [ ] Python client installed: `pip install surrealdb`
- [ ] Environment variable `SURREAL_URL` added to `backend/.env`
- [ ] Test connection successful (can insert/query)

**Commands:**
```bash
cd backend
docker run --rm -d -p 8000:8000 surrealdb/surrealdb:latest start --log debug --user root --pass root memory
pip install surrealdb
```

**Environment Variable:**
```
SURREAL_URL=ws://127.0.0.1:8000/rpc
SURREAL_USER=root
SURREAL_PASS=root
SURREAL_NS=narrateme
SURREAL_DB=production
```

#### Task 1B: Database Schema (15 min)
**File:** `backend/app/db/surreal_client.py` (create new)

**Schema:**
```python
# Table: readers
{
    id: string,           # auto-generated
    name: string,         # kid's name
    last_story: string,   # short snippet (first 50 chars)
    last_word: string,    # practice word from comprehension check
    last_seen: datetime,  # timestamp
    created_at: datetime
}
```

**Functions to implement:**
- `async def init_db()` - initialize connection
- `async def get_db()` - return connection instance

#### Task 1C: Reader API Endpoint (25 min)
**File:** `backend/app/routers/readers.py` (create new)

**Endpoint 1:** `POST /api/reader/session`
```python
# Request body
{
    "name": "Emma",
    "story_snippet": "Once upon a time, there was a lost puppy...",
    "practice_word": "adventure"  # optional, from comprehension check
}

# Response
{
    "reader_id": "reader:abc123",
    "name": "Emma",
    "is_returning": true,  # false if first time
    "previous_session": {   # null if first time
        "last_story": "The Lost Puppy...",
        "last_word": "adventure",
        "last_seen": "2026-10-15T14:30:00Z"
    }
}
```

**Logic:**
1. Check if reader with this name exists
2. If exists: return previous session data + update with new session
3. If new: create reader, return `is_returning: false`

**File:** `backend/app/main.py`
- Import and mount the reader router

**Acceptance Criteria:**
- [ ] Endpoint accessible at `POST http://localhost:8000/api/reader/session`
- [ ] First call with name "Emma" returns `is_returning: false`
- [ ] Second call with same name returns `is_returning: true` + previous data
- [ ] Data persists in SurrealDB (verify with query)

---

### 🎨 PERSON 2: Frontend Engineer - Name Input (40-50 min)
**Stack:** React, Next.js, TypeScript

#### Task 2A: Name Input Modal Component (30 min)
**File:** `frontend/src/app/components/NameModal.tsx` (create new)

**Requirements:**
- Modal appears on app load if no name in localStorage
- Input field: "What's your name?"
- Submit button: "Start Reading!"
- On submit:
  - Store name in `localStorage.getItem("narrateme:reader-name")`
  - Call backend `POST /api/reader/session` with `{name, story_snippet: "", practice_word: null}`
  - Store `reader_id` in `localStorage.getItem("narrateme:reader-id")`
  - Close modal

**UI Specs:**
- Center of screen, backdrop blur
- Friendly owl illustration (use existing `/public/owls/happy.png`)
- Large text input (min 2 chars)
- Primary button styling (match existing design system)

**Acceptance Criteria:**
- [ ] Modal shows on first visit
- [ ] Name validation (2-20 characters, letters only)
- [ ] Name saves to localStorage on submit
- [ ] Modal doesn't show on subsequent page loads
- [ ] Backend API called successfully

**Edge Cases:**
- If backend fails, still save name locally and show generic welcome
- Allow user to clear their name (dev mode only, add button in console)

#### Task 2B: Integrate into App (15 min)
**File:** `frontend/src/app/page.tsx`

- Import `<NameModal />`
- Add state: `const [showNameModal, setShowNameModal] = useState(false)`
- On component mount, check localStorage for name
- If no name exists, show modal
- Pass callback to modal to close after submission

**Acceptance Criteria:**
- [ ] Modal appears correctly on landing page
- [ ] Doesn't interfere with existing story generator
- [ ] Works on both dev and production builds

---

### 🌟 PERSON 3: Frontend Engineer - Welcome Message (50-60 min)
**Stack:** React, Next.js, TypeScript

**Dependencies:** Wait for Person 2 to finish Task 2A (name modal)

#### Task 3A: Fetch Reader Data on Load (20 min)
**File:** `frontend/src/app/presentation/page.tsx`

**On component mount:**
1. Get `reader_id` from localStorage
2. Get `reader_name` from localStorage
3. If both exist, fetch `POST /api/reader/session` with current session data
4. Store response in state: `readerData`

**State to add:**
```typescript
const [readerData, setReaderData] = useState<{
  name: string;
  is_returning: boolean;
  previous_session: {
    last_story: string;
    last_word: string;
    last_seen: string;
  } | null;
} | null>(null);
```

**Acceptance Criteria:**
- [ ] API call happens on page load
- [ ] Reader data stored in state
- [ ] Error handling if backend unavailable (fallback to name only)

#### Task 3B: Welcome Message UI (20 min)
**File:** `frontend/src/app/presentation/WelcomeMessage.tsx` (create new)

**Component Props:**
```typescript
interface WelcomeMessageProps {
  name: string;
  isReturning: boolean;
  previousSession?: {
    last_story: string;
    last_word: string;
    last_seen: string;
  };
}
```

**UI Design:**
- Appears at top of presentation page, before story starts
- Owl avatar (happy emotion) on left
- Speech bubble with message:

**First-time message:**
```
"Hi [Name]! I'm so excited to read with you today! 🦉"
```

**Returning user message:**
```
"Welcome back, [Name]! Last time we read about '[last_story snippet]'
and you practiced the word '[last_word]'. Ready for another adventure?"
```

**Styling:**
- Match existing owl avatar positioning
- Speech bubble: white background, rounded corners, shadow
- Dismissible (click anywhere or auto-hide after 8 seconds)
- Fade-in animation

**Acceptance Criteria:**
- [ ] Correct message shown for first-time vs returning users
- [ ] Previous session data displays accurately
- [ ] Dismissible and doesn't block story playback
- [ ] Responsive on mobile

#### Task 3C: Track Current Session (15 min)
**File:** `frontend/src/app/presentation/EngagementModal.tsx`

**When user completes a comprehension check:**
- Extract the question text as the "practice word" (simplified: just the first keyword)
- Store in state: `currentPracticeWord`

**On story completion** (last scene ends):
- Call `POST /api/reader/session` with:
  ```json
  {
    "name": readerData.name,
    "story_snippet": scenes[0].text.substring(0, 50),
    "practice_word": currentPracticeWord
  }
  ```

**Acceptance Criteria:**
- [ ] Practice word extracted from comprehension check
- [ ] Session saved to backend on story completion
- [ ] Error handling (fails silently if backend down)
- [ ] Console log confirmation: "Session saved for [name]"

---

## 🔗 Dependencies & Timeline

```
┌─────────────────────────────────────────────────────────────┐
│ HOUR 1 (Parallel Work)                                      │
├─────────────────────────────────────────────────────────────┤
│ Person 1: Task 1A → 1B → 1C (Backend + DB)                 │
│ Person 2: Task 2A → 2B (Name Modal)                        │
│ Person 3: [BLOCKED - Wait for Person 2]                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ HOUR 2 (Integration)                                        │
├─────────────────────────────────────────────────────────────┤
│ Person 1: Testing + Bug fixes                              │
│ Person 2: Help Person 3 with integration                   │
│ Person 3: Task 3A → 3B → 3C (Welcome Message + Tracking)   │
└─────────────────────────────────────────────────────────────┘
```

**Critical Path:**
1. Person 1 must finish Task 1C first (backend API)
2. Person 2 must finish Task 2A before Person 3 can start
3. Everyone integrates in final 30 minutes

---

## 🧪 Testing Checklist

**Backend (Person 1):**
- [ ] SurrealDB container running: `docker ps`
- [ ] API endpoint returns 200: `curl -X POST http://localhost:8000/api/reader/session -d '{"name":"Test"}'`
- [ ] Data persists: call twice with same name, second returns `is_returning: true`

**Frontend (Person 2):**
- [ ] Name modal appears on fresh browser (clear localStorage first)
- [ ] Name saves and modal doesn't re-appear on refresh
- [ ] localStorage has `narrateme:reader-name` and `narrateme:reader-id`

**Integration (Person 3):**
- [ ] Welcome message shows "Hi [Name]!" on first story
- [ ] Complete story, return to home, start new story
- [ ] Welcome message shows "Welcome back..." with previous story info

**Full Flow (All):**
1. Clear all localStorage + database
2. Open app → enter name → complete story → return
3. Should see personalized welcome with previous session data

---

## 📦 Deliverables

**Code Files:**
- `backend/app/db/surreal_client.py` (new)
- `backend/app/routers/readers.py` (new)
- `backend/app/main.py` (modified - mount router)
- `backend/requirements.txt` (modified - add surrealdb)
- `backend/.env` (modified - add SURREAL_* vars)
- `frontend/src/app/components/NameModal.tsx` (new)
- `frontend/src/app/presentation/WelcomeMessage.tsx` (new)
- `frontend/src/app/page.tsx` (modified)
- `frontend/src/app/presentation/page.tsx` (modified)
- `frontend/src/app/presentation/EngagementModal.tsx` (modified)

**Demo Script:**
- Show first-time user flow
- Show returning user flow with personalized message
- Show SurrealDB data in terminal/UI

**Sponsor Callouts for Judges:**
- "SurrealDB handles multi-model data - we store reader profiles, sessions, and practice words"
- "Real-time updates mean the owl remembers kids instantly"
- "Graph relationships let us track reading progress over time" (future feature)

---

## 🚨 Scope Cuts (If Running Out of Time)

**Priority 1 (Must Have):**
- Name storage + retrieval
- Welcome back message with name

**Priority 2 (Should Have):**
- Previous story snippet in welcome message
- Practice word tracking

**Priority 3 (Nice to Have):**
- Last seen timestamp formatting
- Welcome message animations
- Mobile responsive polish

**If <30 min left:**
- Skip practice word tracking
- Hardcode a welcome message with name only
- Focus on SurrealDB demo (show data in terminal)

---

## 🎤 Demo Talking Points

**Setup (30 sec):**
"Our app teaches kids to read through AI-generated illustrated stories. But we wanted it to remember each child's progress."

**Show Feature (60 sec):**
1. "First time: owl asks for your name - stored in SurrealDB"
2. "Complete a story, then come back..."
3. "The owl remembers! 'Welcome back Emma, last time you practiced adventure'"

**Sponsor Integration (30 sec):**
"We chose SurrealDB because:
- Multi-model: stores user profiles AND session data
- Real-time: instant retrieval on page load
- Schemaless: perfect for evolving reading metrics
- Graph-ready: we can build word relationship networks next"

**Impact (30 sec):**
"Teachers told us memory is huge - they need to track which words kids struggle with. Now the owl can adapt future stories based on reading history."

---

## 📞 Communication Protocol

**Slack channel:** #memory-owl-sprint

**Status updates every 30 min:**
- ":white_check_mark: Task XY done"
- ":construction: Task XY in progress, ETA 15 min"
- ":sos: Task XY blocked on [issue]"

**Merge strategy:**
- Person 1: Create branch `feat/surreal-backend`
- Person 2: Create branch `feat/name-modal`
- Person 3: Create branch `feat/welcome-message`
- Merge to `main` as tasks complete (no PRs, move fast)

**Final integration (last 20 min):**
- Meet on call, merge all branches
- Person 1: Run backend + DB
- Person 2: Test name flow
- Person 3: Test welcome message
- All: Polish demo script

---

## 🐛 Known Risks

| Risk | Mitigation |
|------|------------|
| SurrealDB setup fails | Use SQLite fallback (swap in 10 min) |
| Backend/frontend connection issues | CORS - add localhost:3000 to CORS_ORIGINS |
| Modal blocks story generator | Z-index fix, test on /presentation page first |
| Practice word extraction complex | Hardcode to null, just demo name + story snippet |
| Docker not installed | Use SurrealDB Cloud (free tier, 5 min setup) |

---

## ✅ Definition of Done

- [ ] 3 people can demo independently
- [ ] Database persists data (survives page refresh)
- [ ] Welcome message shows personalized info
- [ ] Code committed to main branch
- [ ] Demo script rehearsed once
- [ ] Screenshot of SurrealDB data for slides

**Go build! 🚀**
