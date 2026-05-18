# Business Receptionist AI Agent — Full Documentation

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [System Components](#3-system-components)
4. [Workflow Logic](#4-workflow-logic)
5. [Skills System](#5-skills-system)
6. [API Reference](#6-api-reference)
7. [Google Calendar Integration](#7-google-calendar-integration)
8. [WhatsApp Integration](#8-whatsapp-integration)
9. [Monitor Dashboard](#9-monitor-dashboard)
10. [Configuration](#10-configuration)
11. [Data Storage](#11-data-storage)
12. [Deployment & Running](#12-deployment--running)
13. [Fail-Closed Design](#13-fail-closed-design)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Overview

The **Business Receptionist** is a 24/7 WhatsApp-integrated AI receptionist that schedules appointments via Google Calendar. It uses a **skills-based conversation architecture** where an LLM (Ollama running `deepseek-r1:8b`) dynamically decides which tools to invoke during a conversation, rather than relying on a hard-coded state machine.

**Core capabilities:**
- Respond to customer inquiries on WhatsApp 24/7
- List business services with durations and pricing
- Check Google Calendar availability for specific dates/times
- Find all available time slots on a given date
- Create calendar bookings after explicit user confirmation
- Persist conversation sessions with daily reset

---

## 2. Architecture

### High-Level Diagram

```
WhatsApp User
    |
    | Baileys WebSocket
    v
+------------------+
| whatsapp_agent.js|  <--- PRIMARY ENTRY POINT
| (Node.js)        |
+------------------+
    |                     +-------------------+
    | HTTP POST           | Ollama (Local)    |
    +-------------------> | deepseek-r1:8b    |
    |                     | port 11434        |
    |                     +-------------------+
    |
    | Google Calendar API (OAuth 2.0)
    +-------------------> Google Calendar
    |
    | Reads/Writes
    +-------------------> data/sessions.json
    |
    | Reads
    +-------------------> .env / .env.whatsapp / token.json

+------------------+
| server/index.js  |  <--- REST API SERVER (port 3000)
| (Express)        |
+------------------+
    | Serves
    +-------------------> public/monitor.html (Dashboard)
    |                   public/index.html (Config)
    |
    | Reads
    +-------------------> data/sessions.json
    |                   server/logs/agent.log
    |                   token.json
    |
    | Protected Endpoints (API Key)
    +-------------------> /api/availability
    |                   /api/appointments
    |                   /api/logs
    |                   /api/restart
    |
    | Monitor Endpoints (no auth)
    +-------------------> /api/monitor/sessions
                        /api/monitor/whatsapp-status
                        /api/monitor/ollama-status
                        /api/monitor/calendar-status
                        /api/monitor/logs

+---------------------+
| whatsapp_bridge/    |  <--- STANDALONE BRIDGE (optional)
| bridge.mjs          |       stdin/stdout IPC
+---------------------+

+---------------------+
| Python Agent (legacy)|  <--- ALTERNATIVE (not in active use)
| agent.py            |
| calendar_manager.py |
| context_manager.py  |
| customer_manager.py |
| ollama_manager.py   |
+---------------------+
```

### Process Model

Two independent Node.js processes:

| Process | File | Purpose |
|---------|------|---------|
| WhatsApp Agent | `whatsapp_agent.js` | Long-running WhatsApp bridge + AI + Calendar |
| Express Server | `server/index.js` | REST API + Monitor Dashboard |

They share `data/sessions.json` and `token.json` but run independently.

---

## 3. System Components

### 3.1 `whatsapp_agent.js` (Primary Agent — 508 lines)

The core agent. Connects to WhatsApp via Baileys, receives messages, passes them through Ollama with a skills-based prompt, executes skill calls against Google Calendar, and replies on WhatsApp.

**Key functions:**

| Function | Line | Purpose |
|----------|------|---------|
| `loadSessions()` / `saveSessions()` | 36-49 | Read/write `data/sessions.json` |
| `getSession(sender)` | 52-63 | Get or create session, reset on new day |
| `resolveDate(text)` | 66-73 | Parse "today", "tomorrow", YYYY-MM-DD |
| `extractTime(text)` | 76-89 | Parse HH:MM or "X am/pm" |
| `stripThinking(text)` | 99-101 | Remove `<think>` tags (deepseek-r1) — applied only for final display, NOT in callOllama |
| `getCalendarClient()` | 96-109 | Create OAuth2 client from env + token |
| `createBooking(auth, eventData)` | 111-125 | Insert Google Calendar event |
| `checkAvailability(auth, dateStr, startTimeStr, durationMins)` | 128-156 | Check if specific slot is free |
| `findAvailableSlots(auth, dateStr, durationMins)` | 158-198 | Find free 30-min-increment slots |
| `callOllama(prompt)` | 433-461 | HTTP POST to Ollama `/api/generate` — returns RAW response (includes `<think>` tags) |
| `callOllamaWithSkills(systemPrompt, userMessage, history, senderPhone)` | 361-444 | Build prompt with skills, call Ollama, parse & execute skills, follow-up call |
| `parseSkillCalls(text)` | 298-317 | Regex parse `[SKILL:name|param=value]` |
| `executeSkills(calls)` | 319-335 | Execute parsed skill calls sequentially |
| `main()` | 411-506 | Set up Baileys socket, event handlers |

### 3.2 `server/index.js` (Express REST API — 468 lines)

Express server on port 3000 providing REST API and monitor dashboard.

**Middleware stack:** `helmet` → `cors` → JSON parser → rate limiter (100 req/15min) → request counter

### 3.3 `whatsapp_bridge/bridge.mjs` (Standalone Bridge — 99 lines)

A separate process communicating via stdin/stdout JSON IPC. Useful for integrating the WhatsApp connection into other parent processes.

**stdout messages:** `qr`, `authenticated`, `user_info`, `disconnected`, `logged_out`, `ready`, `message`
**stdin commands:** `send_message` (with `to` and `text` fields)

### 3.4 Python Components (Legacy/Alternative)

| File | Class | Purpose |
|------|-------|---------|
| `agent.py` | `Agent` | Ties CalendarManager, CustomerManager, ContextManager, OllamaManager together. Has `_handle_create_event()`, `_handle_list_events()`, `_process_with_ai()`. No actual WhatsApp integration — `_send_response()` only prints to console. |
| `calendar_manager.py` | `CalendarManager` | Google Calendar operations: `list_events()`, `check_conflict()`, `find_available_slots()`. Business hours: 8AM-6PM, 30-min granularity. |
| `context_manager.py` | `ContextManager` | Per-phone-number context persistence to `data/contexts.json`. Stores state, message history (last 10), name, phone, email, booking details. |
| `customer_manager.py` | `CustomerManager` | Customer CRUD to `data/customers.json`. Stores phone, name, email with timestamps. |
| `ollama_manager.py` | `OllamaManager` | HTTP POST to Ollama `/api/generate`, 120s timeout, model "mistral:latest". |

### 3.5 Public Web Pages

| File | Purpose |
|------|---------|
| `public/monitor.html` | Monitor dashboard SPA — dark theme, auto-refresh (5s), 3 tabs: Health, Messages, Troubleshooting Log |
| `public/index.html` | Configuration dashboard — WhatsApp QR code generator, Google Calendar connection form, error log viewer, test runner |

---

## 4. Workflow Logic

### 4.1 Message Reception → Response (Complete Flow)

```
Step 1: WhatsApp Message Received
──────────────────────────────────
- Baileys fires `messages.upsert` event
- Filter: ignore messages from self (fromMe), non-notify types, empty text
- Extract: sender JID (remoteJid), pushName, text content

Step 2: Session Management
──────────────────────────
- getSession(sender) loads or creates session from data/sessions.json
- If new calendar day detected → reset session (pendingDate, pendingService, pendingTime, history)
- Push "User: {text}" to session.history

Step 3: Pre-extract Structured Info
────────────────────────────────────
- resolveDate(lowerText): detect "today", "tomorrow", YYYY-MM-DD
- extractTime(lowerText): detect HH:MM, "X am/pm"
- Check if message mentions a known service
- Update session.pendingDate, pendingTime, pendingService

Step 4: Build Context Summary
─────────────────────────────
Context passed to AI:
- User push name
- Phone number (JID)
- Current date/time
- Pending date/time/service (if any)

Step 5: Build Full AI Prompt (callOllamaWithSkills)
────────────────────────────────────────────────────
System prompt instructs the AI to:
- Be a friendly professional receptionist
- Clarify services, check availability, propose slots, create bookings

Prompt includes:
- Context summary
- All skill descriptions with parameter names
- IMPORTANT RULES (see §13)
- Conversation history (last messages)
- User's current message

Step 6: First AI Call → Ollama
───────────────────────────────
- HTTP POST to http://localhost:11434/api/generate
- Model: deepseek-r1:8b
- stream: false
- Returns RAW response (includes `<think>` tags + [SKILL:...] tags)
- stripThinking() is NOT applied here — [SKILL:...] tags inside <think> blocks must be preserved

Step 7: Parse Skill Calls (from RAW response)
──────────────────────────────────────────────
- Regex: /\[SKILL:(\w+)(?:\|([^\]]+))?\]/g
- Runs on raw AI response (with think tags intact) — finds skill calls even inside `<think>` blocks
- If no skill calls found → strip thinking + return AI response directly
- stripThinking() is applied only for the final display text sent to the user

Step 8: Execute Skills (Sequential)
────────────────────────────────────
For each [SKILL:xxx] tag:
  list_services        → returns 5 service descriptions
  check_availability   → calls checkAvailability() → Google Calendar events.list
  find_available_slots → calls findAvailableSlots() → scans 8AM-6PM
  create_booking       → verifies availability, creates calendar event

Each skill returns text (or JSON for create_booking).

Step 9: Response Formatting
────────────────────────────
- If create_booking succeeded → response is formatted DIRECTLY in JavaScript (bypasses follow-up AI)
  Includes: service name, date, time, and Google Calendar htmlLink
- If no booking or booking failed → follow-up AI call with skill results
  Prompt tells AI the result and asks for natural response
- stripThinking() applied to final display text
- [SKILL:...] tags stripped from final output

Step 10: Send Reply
────────────────────
- sock.sendMessage(sender, { text: result.response })
- Push "Agent: {response}" to session.history
- If booking created → reset pending date/time/service

Step 11: Persist Session
─────────────────────────
- saveSessions() writes to data/sessions.json
- Also auto-saves every 30 seconds via setInterval
```

### 4.2 Session State Model

Each session in `data/sessions.json`:
```json
{
  "[sender-jid]": {
    "state": "idle",
    "pendingDate": "2026-05-18",
    "pendingService": { "id": "consultation", ... },
    "pendingTime": "10:00",
    "history": ["User: Hello", "Agent: Hi! How can I help?"],
    "lastActiveDate": "2026-05-18"
  }
}
```

- **Daily reset:** When `lastActiveDate !== today`, session is reset
- **Auto-persist:** Every 30 seconds via `setInterval(saveSessions, 30000)`
- **History:** Array of "User: ..." and "Agent: ..." strings

### 4.3 Google Calendar Availability Check Logic

```
checkAvailability(date, startTime, duration)
    ↓
Build start/end Date objects
    ↓
calendar.events.list({
    timeMin: start,
    timeMax: end,
    singleEvents: true
})
    ↓
For each event:
    Skip if event.start.date (all-day events — no dateTime)
    Check overlap: eventStart < rangeEnd && eventEnd > rangeStart
    ↓
If any overlap → { available: false }
If no overlap  → { available: true }
If API error   → { available: false, error: message }  (FAIL-CLOSED)
```

### 4.4 Available Slot Finding Logic

```
findAvailableSlots(date, durationMinutes)
    ↓
dayStart = 8:00, dayEnd = 18:00
    ↓
Fetch all events between dayStart and dayEnd
    ↓
Filter to events with dateTime (skip all-day)
Build busy intervals array
    ↓
cursor = dayStart
while cursor + duration <= dayEnd:
    slotEnd = cursor + duration
    if slot not busy:
        add to available slots
    cursor += 30 minutes
    ↓
Return array of "HH:MM" strings
```

### 4.5 Booking Creation Logic

```
create_booking(date, time, service_id, name, phone)
    ↓
Look up service by id or name
If not found → return error
    ↓
Check availability via checkAvailability()
If error → reject: "Could not verify availability"
If NOT available → find alternates, return alternatives
    ↓
Create Google Calendar event:
    • title: "{name} - {service.name}"
    • description: "WhatsApp Booking"
    • start/end with timezone
    • attendees: [phone, BUSINESS_EMAIL]
    ↓
If event created successfully → { success: true, event_id, htmlLink }
If error → { success: false, message }
```

---

## 5. Skills System

### 5.1 Available Skills

| Skill | Params | Description |
|-------|--------|-------------|
| `list_services` | *(none)* | List all 5 business services with name, duration, price, description |
| `check_availability` | `date`, `time`, `duration` | Check if a specific date/time slot is free |
| `find_available_slots` | `date`, `duration` | Find all free slots on a date for the given duration |
| `create_booking` | `date`, `time`, `service_id`, `name`, `phone` | Create a calendar booking after user confirmation |

### 5.2 Skill Invocation Format

The AI model includes skill calls in its response using this format:

```
[SKILL:skill_name|param1=value1|param2=value2]
```

Examples:
```
[SKILL:list_services]
[SKILL:check_availability|date=2026-05-18|time=10:00|duration=60]
[SKILL:find_available_slots|date=2026-05-18|duration=30]
[SKILL:create_booking|date=2026-05-18|time=10:00|service_id=consultation|name=John|phone=123456]
```

### 5.3 Skill Execution Pipeline

1. AI generates response text containing `[SKILL:...]` tags
2. `parseSkillCalls()` extracts all skill calls via regex
3. `executeSkills()` executes each call **sequentially** (not parallel)
4. Results are collected as text
5. A follow-up AI call generates the final natural language response incorporating results

### 5.4 Business Services

| ID | Name | Duration | Price |
|----|------|----------|-------|
| `consultation` | Free Consultation | 30 min | $0 |
| `initial-meeting` | Initial Business Meeting | 60 min | $150 |
| `product-demo` | Product Demonstration | 45 min | $75 |
| `support-session` | Technical Support Session | 30 min | $100 |
| `follow-up` | Follow-up Meeting | 20 min | $50 |

---

## 6. API Reference

### 6.1 Express Server Endpoints

Base URL: `http://localhost:3000`

#### Public Endpoints (No Auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Root: name, version, status, uptime, monitorUrl |
| `GET` | `/api/health` | Runtime health: status, uptime, requestCount, errorCount |
| `GET` | `/api/services` | List all 5 business services |
| `GET` | `/api/services/:id` | Get specific service by ID |
| `GET` | `/api/monitor/sessions` | Session analytics from data/sessions.json |
| `GET` | `/api/monitor/whatsapp-status` | Check Baileys auth directory |
| `GET` | `/api/monitor/ollama-status` | Probe Ollama `/api/tags` (3s timeout) |
| `GET` | `/api/monitor/calendar-status` | Validate token.json credentials |
| `GET` | `/api/monitor/logs` | Read server logs (same as `/api/logs` but no auth) |

#### Protected Endpoints (Requires `x-api-key` header or `api_key` query param)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/availability?date=YYYY-MM-DD&duration=60` | Get available slots for a date |
| `POST` | `/api/appointments` | Create a calendar appointment |
| `GET` | `/api/logs?limit=100` | Read server logs with filtering |
| `POST` | `/api/restart` | Reset runtime state |

#### POST `/api/appointments` Body

```json
{
  "serviceId": "consultation",
  "clientName": "John Doe",
  "clientEmail": "john@example.com",
  "date": "2026-05-18",
  "time": "10:00",
  "notes": "Optional notes",
  "videoMeeting": false
}
```

### 6.2 WhatsApp Endpoints (for the Bridge)

The bridge communicates via **stdin/stdout JSON IPC** — not HTTP. It's a separate process that can be controlled by any parent process.

**stdout events:**
```json
{"type":"qr","qr":"..."}
{"type":"authenticated"}
{"type":"user_info","user":{...}}
{"type":"disconnected","shouldReconnect":true,"reason":"..."}
{"type":"logged_out"}
{"type":"ready"}
{"type":"message","sender":"...","pushName":"...","text":"...","timestamp":...,"messageId":"..."}
```

**stdin commands:**
```json
{"type":"send_message","to":"1234567890@s.whatsapp.net","text":"Hello"}
```

---

## 7. Google Calendar Integration

### 7.1 OAuth 2.0 Authentication

- **Credentials:** `config/credentials.json` (Google installed app credentials)
- **Tokens:** `token.json` (access_token, refresh_token, expiry_date)
- **Scope:** `https://www.googleapis.com/auth/calendar.events` (read/write events, NOT freebusy)
- **Token refresh:** Automatic when `Date.now() > tokenData.expiry`

### 7.2 Token Setup

Use `exchange_token.js`:
```
node exchange_token.js                    # Generates auth URL
node exchange_token.js <AUTHORIZATION_CODE>  # Exchanges code for tokens
```

### 7.3 API Usage

| Operation | Google API | Endpoint |
|-----------|------------|----------|
| Check availability | `calendar.events.list` | `GET /calendar/v3/calendars/primary/events` |
| Find available slots | `calendar.events.list` | `GET /calendar/v3/calendars/primary/events` |
| Create booking | `calendar.events.insert` | `POST /calendar/v3/calendars/primary/events` |

**Important:** Uses `events.list` (not `freebusy.query`) because the OAuth scope only covers `calendar.events`, not the broader `calendar` scope required by the freebusy API.

### 7.4 Business Hours

- **Start:** 8:00 AM
- **End:** 6:00 PM
- **Slot granularity:** 30 minutes
- **All-day events:** Skipped during conflict detection (only timed events block slots)

---

## 8. WhatsApp Integration

### 8.1 Baileys Library

Uses `@whiskeysockets/baileys` (unofficial WhatsApp Web API):

- **Auth state:** Stored in `sessions/baileys_auth/` (multi-file auth state)
- **QR authentication:** Printed to terminal on first connection
- **Reconnection:** Auto-reconnects on disconnect (unless logged out)
- **Pino logger:** Silent level (no verbose logging)

### 8.2 Message Handling

- **Event:** `messages.upsert` with type `notify`
- **Filters:** Skip `fromMe` messages, non-text messages
- **Text extraction:** `msg.message.conversation` | `extendedTextMessage.text` | `imageMessage.caption`
- **Reply:** `sock.sendMessage(sender, { text: response })`

### 8.3 Bridge Mode (`bridge.mjs`)

A standalone process that exposes WhatsApp through stdin/stdout JSON. Useful as a subprocess:
- Parent process spawns `node whatsapp_bridge/bridge.mjs`
- Reads JSON messages from stdout
- Sends JSON commands via stdin

---

## 9. Monitor Dashboard

### 9.1 `public/monitor.html`

A dependency-free single-page application with a dark GitHub-style theme.

**Auto-refresh:** Every 5 seconds via `setInterval(refreshAll, 5000)`

#### Health Tab
- 6 metric cards: Agent Status, Requests Served, Errors, Active Sessions, Messages Handled, Unanswered
- 4 service connectivity dots: WhatsApp Bridge, Ollama AI, Google Calendar, Express Server

#### Messages Tab
- Summary cards: Sessions, User Messages, Answered, Unanswered
- Expandable session cards with conversation history
- Empty agent replies flagged in red
- Unanswered badge on tab

#### Troubleshooting Log Tab
- Filter by level (All/Info/Error/Warn)
- Text search
- Auto-scroll toggle
- Color-coded rows (error=red, warn=yellow)

### 9.2 `public/index.html`

Configuration dashboard with tabs:
- **WhatsApp QR:** Generate WhatsApp link and QR code for customer access
- **Google Calendar:** Enter OAuth credentials, test connection
- **Error Logs:** View, export, clear logs
- **Test Summary:** Run test suite for WhatsApp and Calendar

---

## 10. Configuration

### 10.1 Environment Files

#### `.env` (Primary)
```
PORT=3000
TIMEZONE=Asia/Kuala_Lumpur
API_KEY=your_api_key_here
CORS_ORIGIN=*
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
GOOGLE_TOKEN_FILE=./token.json
BUSINESS_EMAIL=business@example.com
OLLAMA_HOST=http://localhost:11434
```

#### `.env.whatsapp` (WhatsApp-specific overrides)
```
GOOGLE_CREDENTIALS_FILE=./config/credentials.json
GOOGLE_TOKEN_FILE=./token.json
NODE_MODULES_PATH=./node_modules
BUSINESS_EMAIL=joseph.chum@imago-synergy.com
```

### 10.2 OAuth Credentials

| File | Purpose |
|------|---------|
| `config/credentials.json` | Google Cloud OAuth 2.0 installed app credentials (client_id, client_secret, redirect_uris) |
| `token.json` | Generated OAuth tokens (access_token, refresh_token, scope, expiry_date). This is gitignored. |

---

## 11. Data Storage

All persistence uses flat JSON files (no database):

| File | Schema | Managed By |
|------|--------|------------|
| `data/sessions.json` | `{ [jid: string]: { state, pendingDate, pendingService, pendingTime, history[], lastActiveDate } }` | `whatsapp_agent.js` |
| `data/customers.json` | `{ [phone: string]: { phone, name, email, created_at, updated_at } }` | Python `CustomerManager` (legacy) |
| `data/contexts.json` | `{ [phone: string]: { state, messages[], name, phone, email, booking_details } }` | Python `ContextManager` (legacy) |
| `server/logs/agent.log` | JSON lines log format | `server/index.js` |
| `token.json` | `{ access_token, refresh_token, scope, expiry_date }` | `getCalendarClient()` / `getOAuth2Client()` |
| `sessions/baileys_auth/` | Multi-file auth state directory | Baileys library |

---

## 12. Deployment & Running

### 12.1 Prerequisites

- Node.js 18+
- Ollama running locally with `deepseek-r1:8b` model pulled
- Google Cloud project with Calendar API enabled
- A Google OAuth 2.0 installed app credential
- A phone number to use with WhatsApp

### 12.2 Setup Steps

```bash
# 1. Install Node.js dependencies
npm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env with your values

# 3. Set up WhatsApp env
# Edit .env.whatsapp

# 4. Set up Google Calendar OAuth token
node exchange_token.js           # Get auth URL
# Visit URL, authorize, get code
node exchange_token.js <CODE>    # Save token.json

# 5. Ensure Ollama is running with the correct model
ollama pull deepseek-r1:8b
ollama serve

# 6. Start the system
# Option A: Start both processes
npm start          # Express server on port 3000
node whatsapp_agent.js   # WhatsApp agent (separate terminal)

# Option B: Start bridge (replaces whatsapp_agent.js)
node whatsapp_bridge/bridge.mjs
```

### 12.3 Running the Processes

| Command | What it does |
|---------|-------------|
| `npm start` | Starts Express server only (port 3000) |
| `node whatsapp_agent.js` | Starts WhatsApp agent (Baileys + Ollama + Calendar) |
| `node whatsapp_bridge/bridge.mjs` | Starts WhatsApp bridge (stdin/stdout IPC) |
| `node server/index.js` | Same as `npm start` |
| `run.bat` | Starts Python runner (legacy — runner.py does not exist) |

### 12.4 Monitor Access

Once the server is running:
- Dashboard: `http://localhost:3000/monitor.html`
- Config page: `http://localhost:3000/`
- API root: `http://localhost:3000/`

---

## 13. Fail-Closed Design

The scheduling system follows a **fail-closed** principle to prevent false-positive booking confirmations.

### 13.1 Guarantees

| Condition | Behavior |
|-----------|----------|
| Google Calendar API unreachable | `checkAvailability()` returns `{available: false, error}` |
| Calendar API error in check | `check_availability` skill returns "ERROR: Could not verify availability..." |
| Calendar API error during booking | `create_booking` rejects the booking — never proceeds |
| All-day events detected | Skipped in conflict detection (only timed events block slots) |
| AI prompt ambiguity | Rules explicitly state: "NEVER tell the user a booking is confirmed unless create_booking returned success: true" |
| Booking creation fails | Returns `{success: false}` — AI tells user booking failed |
| Slot verification fails | AI offers alternatives — does NOT confirm the original slot |

### 13.2 AI Prompt Rules

The prompt constructed in `callOllamaWithSkills` injects these mandatory rules:

RULES:
- FIRST message asking to book → output ONLY [SKILL:check_availability|...] (no other text)
- [SKILL:...] runs silently and is hidden from user
- When user says yes/confirm after check → output [SKILL:create_booking|...] with all params from context (do NOT check availability again)
- After create_booking, tell user the result
- Keep replies to 1-2 sentences

The prompt also includes dynamic examples with the actual today/tomorrow dates and the user's name from context.

Success path (no follow-up AI):
- When `create_booking` returns `success: true`, the response is formatted directly in JavaScript code (bypasses the follow-up AI call) and includes the Google Calendar `htmlLink`.

Failure path (follow-up AI):
- If no skill calls are generated → AI's raw text is stripped of `<think>` tags and returned directly
- If availability was checked → follow-up AI receives the result and generates a natural response
- If `create_booking` failed → follow-up AI receives the error and generates a helpful message

---

## 14. Troubleshooting

### 14.1 Common Issues

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| WhatsApp QR not scanning | Baileys version mismatch | Ensure `@whiskeysockets/baileys` is installed |
| WhatsApp disconnected | Session expired | Delete `sessions/baileys_auth/` and restart |
| "I am having trouble" response | Ollama unreachable | Check `ollama serve` is running on port 11434 |
| Calendar booking fails | Token expired or invalid | Run `node exchange_token.js <CODE>` again |
| Calendar availability always "unavailable" | Wrong OAuth scope | Token must have `calendar.events` scope |
| Port 3000 in use | Another process on that port | Change PORT in .env or kill conflicting process |
| `npm start` fails | PowerShell script error | Use `cmd /c npm start` instead |
| Monitor shows "not initialized" | No WhatsApp auth yet | Start `whatsapp_agent.js` and scan QR |
| Skills not being called | Model response doesn't include `[SKILL:...]` tags | Check Ollama model is `deepseek-r1:8b`. If prompt says "Never mention skill calls", the model may avoid using them. The current prompt uses "runs silently and is hidden" instead. |
| AI says "booked/confirmed" without checking | Skill calls lost inside `<think>` tags | Fixed by returning raw response from `callOllama()` — `[SKILL:...]` inside think blocks is now preserved for `parseSkillCalls()` |
| Date off by one day (e.g., shows May 18 for tomorrow) | `resolveDate()` used `.toISOString()` which converts to UTC | Fixed by using `localDateStr()` helper that uses local time getters |
| Booking link not in response | Follow-up AI ignored `htmlLink` from skill result | Fixed by formatting booking confirmation directly in JavaScript with the link |

### 14.2 Log Files

| File | Location | Contents |
|------|----------|----------|
| Server log | `server/logs/agent.log` | JSON-line formatted operational logs |
| Server stdout | `server_stdout.log` | Captured stdout from server |
| Server stderr | `server_stderr.log` | Captured stderr from server |
| WhatsApp agent | Terminal output | Console logs from `whatsapp_agent.js` |

### 14.3 Monitor Dashboard

Open `http://localhost:3000/monitor.html` to see:
- **Health tab:** Green/red status indicators for all 4 services
- **Messages tab:** Expandable sessions showing full conversation history
- **Logs tab:** Filterable, searchable operational log viewer

### 14.4 E2E Test Log

See `e2e_test_log.md` for detailed end-to-end testing results of the Langfuse observability platform (separate project at `C:\Users\Imago\Desktop\langfuse-platform`).

---

## Appendix: File Index

| File | Lines | Type | Role |
|------|-------|------|------|
| `whatsapp_agent.js` | 508 | Node.js | Primary WhatsApp+AI+Calendar agent |
| `server/index.js` | 468 | Node.js | Express REST API + monitor |
| `whatsapp_bridge/bridge.mjs` | 99 | Node.js | Standalone WhatsApp bridge (stdin/stdout) |
| `exchange_token.js` | 62 | Node.js | Google OAuth token exchange utility |
| `agent.py` | 118 | Python | Legacy Python agent |
| `calendar_manager.py` | 78 | Python | Python Google Calendar operations |
| `context_manager.py` | 63 | Python | Python session/context management |
| `customer_manager.py` | 53 | Python | Python customer CRUD |
| `ollama_manager.py` | 28 | Python | Python Ollama interface |
| `_gen.py` | 27 | Python | Code injection script for skills/handler parts |
| `_write_monitor.cjs` | 192 | Node.js | Script to generate monitor.html |
| `public/monitor.html` | 188 | HTML+JS | Monitor dashboard SPA |
| `public/index.html` | 482 | HTML+JS | Configuration dashboard |
| `.env.example` | 24 | Config | Environment variable template |
| `.env.whatsapp` | 5 | Config | WhatsApp-specific env config |
| `handoff.md` | 199 | Doc | Architecture handoff + bug fix history |
| `package.json` | 35 | Config | Node.js project config |
