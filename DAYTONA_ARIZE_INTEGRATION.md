# Daytona & Arize Integration Guide

This document explains how NarrateMe integrates with **Daytona** (development environments) and **Arize** (AI observability).

---

## 🚀 Daytona Integration

### What is Daytona?

Daytona provides standardized, reproducible development environments. Instead of each developer manually setting up Python, Node.js, databases, and dependencies, Daytona creates identical environments for everyone.

### Benefits for NarrateMe

1. **Instant Setup**: New developers can start coding in minutes, not hours
2. **Consistency**: Everyone has the same Python/Node versions, dependencies, and tools
3. **Includes Everything**: Frontend, backend, and SurrealDB all pre-configured
4. **No "Works on My Machine"**: Environments are identical across team members

### Getting Started with Daytona

#### 1. Install Daytona CLI

```bash
# macOS/Linux
curl -sf https://download.daytona.io/daytona/install.sh | sh

# Windows (PowerShell)
irm https://download.daytona.io/daytona/install.ps1 | iex
```

#### 2. Initialize Daytona Workspace

```bash
# Clone the repo (if you haven't already)
git clone <your-repo-url>
cd narrateme2.0

# Start Daytona workspace
daytona create

# This will:
# - Read .daytona/config.yaml
# - Install Python 3.11+ and Node.js 20+
# - Install all dependencies (pip & npm)
# - Start SurrealDB on port 8002
# - Start backend on port 8000
# - Start frontend on port 3000
```

#### 3. Set API Keys (First Time Only)

```bash
# Set your API keys as Daytona secrets
daytona secret set API_KEY=sk-ant-...
daytona secret set OPENAI_API_KEY=sk-proj-...
daytona secret set ELEVENLABS_API_KEY=sk_...
daytona secret set ARIZE_API_KEY=...
daytona secret set ARIZE_SPACE_KEY=...
```

#### 4. Access the Application

Once the workspace starts, all services are running:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **SurrealDB**: http://localhost:8002

### Daytona Configuration

The workspace is configured in `.daytona/config.yaml` with:
- **Ports**: Auto-forwarded for frontend (3000), backend (8000), SurrealDB (8002)
- **Environment Variables**: Pre-configured for local development
- **Startup Tasks**: Automatically installs dependencies and starts all services
- **VS Code Extensions**: Python, ESLint, Prettier, Tailwind CSS

### Team Workflow

```bash
# Developer joins the team
git clone <repo>
cd narrateme2.0
daytona create

# Daytona handles everything:
# ✓ Python virtual environment
# ✓ npm install
# ✓ Database setup
# ✓ All services running

# Developer starts coding immediately!
```

---

## 📊 Arize Integration

### What is Arize?

Arize is an AI observability platform that monitors ML/AI models in production. For NarrateMe, it tracks all three AI services (Anthropic, OpenAI, ElevenLabs) to help debug issues and improve performance.

### Benefits for NarrateMe

1. **Performance Monitoring**: Track latency for scene generation, images, and narration
2. **Error Detection**: Immediately see when AI calls fail and why
3. **Cost Tracking**: Monitor token usage and API costs across services
4. **Quality Assurance**: Track content safety filtering effectiveness
5. **Debugging**: View inputs/outputs for failed generations

### What Arize Tracks

#### 1. Scene Generation (Anthropic Claude)
- Latency per request
- Story length → number of scenes correlation
- Content blocking rate
- Safety level distribution
- Success/failure rate

#### 2. Image Generation (OpenAI)
- Per-image generation time
- Timeout frequency
- Retry success rate
- Prompt length analysis
- Scene-specific performance

#### 3. Narration (ElevenLabs)
- TTS generation latency
- Text length → audio duration ratio
- Voice consistency
- Success rate

### Setup Instructions

#### 1. Install Arize SDK

```bash
cd backend
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install arize pandas
```

#### 2. Get Arize API Keys

1. Sign up at https://arize.com
2. Create a new Space for "NarrateMe"
3. Copy your API Key and Space Key
4. Set them as environment variables:

```bash
# In .env file
ARIZE_API_KEY=your_api_key_here
ARIZE_SPACE_KEY=your_space_key_here
```

#### 3. Update Requirements

Add to `backend/requirements.txt`:
```
arize>=7.0.0
pandas>=2.0.0
```

#### 4. Integrate Monitoring

The monitoring module (`backend/app/services/arize_monitor.py`) provides:

**Decorator for automatic tracking:**
```python
from app.services.arize_monitor import track_ai_operation

@track_ai_operation("anthropic", "scene_splitting")
async def split_story_into_scenes(story: str):
    # Your existing code
    ...
```

**Manual logging:**
```python
from app.services.arize_monitor import log_scene_generation

log_scene_generation(
    story_length=len(story),
    num_scenes=len(scenes),
    latency_ms=duration_ms,
    blocked=scenes.blocked,
    content_level=content_level
)
```

### Integration Example

Here's how to add Arize monitoring to existing services:

**Before:**
```python
async def split_story_into_scenes(story: str):
    response = await client.messages.create(...)
    return response
```

**After:**
```python
from app.services.arize_monitor import track_ai_operation

@track_ai_operation("anthropic", "scene_splitting")
async def split_story_into_scenes(story: str):
    response = await client.messages.create(...)
    return response
```

That's it! The decorator automatically tracks:
- ✓ Latency
- ✓ Success/failure
- ✓ Error messages
- ✓ Timestamps

### Arize Dashboard

After integration, view metrics at https://app.arize.com:

1. **Model Performance**: Track latency trends over time
2. **Error Analysis**: See which operations fail most often
3. **Cost Monitoring**: Total API calls and estimated costs
4. **Quality Metrics**: Content safety blocking rates
5. **Alerts**: Get notified when latency spikes or errors increase

### Monitoring Queries

Useful queries in Arize:

```sql
-- Average latency by service
SELECT service, AVG(latency_ms)
FROM predictions
GROUP BY service

-- Error rate by operation
SELECT operation,
       COUNT(*) as total,
       SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) as errors
FROM predictions
GROUP BY operation

-- Content blocking rate
SELECT COUNT(*) as total_stories,
       SUM(blocked) as blocked_stories,
       (SUM(blocked) * 100.0 / COUNT(*)) as block_rate
FROM predictions
WHERE operation = 'scene_generation'
```

---

## 🔄 Complete Workflow

### Development Workflow with Both Tools

```bash
# 1. New developer joins
daytona create  # Instant environment setup

# 2. Daytona automatically:
#    - Installs all dependencies
#    - Starts all services
#    - Loads environment variables

# 3. Developer sets API keys (one-time)
daytona secret set ARIZE_API_KEY=...

# 4. Start developing
#    - Code changes auto-reload
#    - Arize tracks all AI calls
#    - View metrics in Arize dashboard

# 5. Debug issues
#    - Check Arize for latency spikes
#    - View failed requests
#    - Analyze error patterns
```

### Production Deployment

#### Railway (Backend)
Add environment variables:
```
ARIZE_API_KEY=your_production_key
ARIZE_SPACE_KEY=your_production_space
```

#### Vercel (Frontend)
No changes needed - Arize monitors backend only.

---

## 📈 Metrics Dashboard

### Key Metrics to Monitor

1. **Latency**
   - P50, P95, P99 for each AI service
   - Target: Scene generation <15s, Images <60s, Narration <30s

2. **Success Rate**
   - Overall success rate per service
   - Target: >95% success rate

3. **Content Safety**
   - Blocking rate by content level
   - Target: <5% blocks on "moderate" level

4. **Cost**
   - API calls per day
   - Estimated monthly cost
   - Cost per story generated

### Alerting Rules

Set up alerts in Arize for:
- ⚠️ Latency >2x normal
- 🚨 Error rate >10%
- 💰 Daily costs spike >50%
- ⛔ Content blocking rate >20%

---

## 🛠️ Troubleshooting

### Daytona Issues

**Workspace won't start:**
```bash
daytona logs  # Check for errors
daytona restart  # Restart workspace
```

**Port conflicts:**
```bash
# Check what's using the port
netstat -ano | findstr :3000  # Windows
lsof -i :3000  # macOS/Linux

# Kill the process or change port in .daytona/config.yaml
```

### Arize Issues

**Metrics not appearing:**
1. Check `ARIZE_API_KEY` and `ARIZE_SPACE_KEY` are set
2. Verify imports: `from app.services.arize_monitor import ...`
3. Check logs for "Arize AI monitoring enabled"
4. Wait 2-3 minutes for data to appear in dashboard

**Disable monitoring temporarily:**
```bash
# Remove API keys to disable
unset ARIZE_API_KEY
unset ARIZE_SPACE_KEY
```

---

## 📚 Resources

- **Daytona Docs**: https://daytona.io/docs
- **Arize Docs**: https://docs.arize.com
- **NarrateMe Architecture**: See `NARRATEME_ARCHITECTURE_AND_STUDY_GUIDE.md`

---

## 🎯 Next Steps

1. ✅ Set up Daytona workspace
2. ✅ Install Arize SDK
3. ✅ Add monitoring decorators to AI services
4. ✅ Configure Arize dashboard
5. ✅ Set up alerting rules
6. 🚀 Deploy to production with monitoring enabled
