# Business Receptionist Agent

A WhatsApp-integrated AI receptionist that schedules appointments via Google Calendar, powered by Ollama (deepseek-r1:8b) with a skills-based conversation architecture.

## Architecture

The agent uses a **skills-based** design instead of a hard-coded state machine. The AI model drives the conversation and calls skills via [SKILL:name|param=value] tags in its responses. The wrapper parses, executes, and feeds results back for a natural conversational response.

### Skills

| Skill | Purpose |
|-------|---------|
| list_services | Lists available business services (consultation, meeting, demo, etc.) |
| check_availability | Checks if a specific date/time slot is free in Google Calendar |
| ind_available_slots | Finds all available time slots on a given date for a given duration |
| create_booking | Creates a calendar booking after explicit user confirmation |

### Fail-Closed Design

The scheduling system follows a **fail-closed** principle:

- If Google Calendar API is unreachable, slots are treated as **unavailable** (not available)
- Bookings are **never confirmed** without explicit verification from Google Calendar
- The AI is instructed to **never** tell users a booking is confirmed unless create_booking returned success: true
- All-day events are skipped during conflict detection (only timed events block slots)

## Components

| File | Purpose |
|------|---------|
| whatsapp_agent.js | Main agent: WhatsApp (Baileys) + Ollama AI + Google Calendar integration |
| gent.py | Python agent entry point (placeholder for alternative implementation) |
| calendar_manager.py | Python Google Calendar operations, conflict detection, slot finding |
| context_manager.py | Resolves ambiguous date expressions (e.g., "tomorrow", "in 3 days") |
| ollama_manager.py | Interface to the Ollama local AI model |
| customer_manager.py | Stores and retrieves customer information (name, email, phone) |
| server/ | Express server with monitor API endpoints |
| public/monitor.html | Monitor dashboard SPA (Health, Messages, Troubleshooting) |

## Setup

1. Ensure Node.js 18+ is installed
2. Install dependencies: 
pm install
3. Set up .env with OLLAMA_HOST, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_FILE, TIMEZONE
4. Set up .env.whatsapp with WhatsApp configuration
5. Ensure 	oken.json exists with valid Google Calendar OAuth credentials
6. Run: 
ode whatsapp_agent.js or 
pm start

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| OLLAMA_HOST | http://localhost:11434 | Ollama API endpoint |
| TIMEZONE | Asia/Kuala_Lumpur | Timezone for calendar events |
| GOOGLE_CLIENT_ID | - | Google OAuth client ID |
| GOOGLE_CLIENT_SECRET | - | Google OAuth client secret |
| GOOGLE_TOKEN_FILE | 	oken.json | Path to Google OAuth token file |
| BUSINESS_EMAIL | - | Business email for booking attendees |
| PORT | 3000 | Express server port |

## Notes

- The agent uses Ollama with deepseek-r1:8b model for conversation
- Conflict detection uses a 5-minute buffer in the Python agent (calendar_manager.py)
- The JS agent (whatsapp_agent.js) uses events.list API (not reebusy.query) for availability checks
- WhatsApp auth state is stored in sessions/baileys_auth/
- Customer information is stored in data/ directory
- Session state resets daily
