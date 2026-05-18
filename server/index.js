import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { google } from 'googleapis';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
const LOG_FILE = path.join(__dirname, 'logs', 'agent.log');
const API_KEY = process.env.API_KEY || '';

// --- Security middleware ---
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST'],
}));
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter);

// --- API key auth middleware ---
function requireApiKey(req, res, next) {
  if (!API_KEY) return next(); // skip if not configured
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key === API_KEY) return next();
  return res.status(401).json({ error: 'Invalid or missing API key' });
}

// --- Input validation helpers ---
function sanitizeString(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').slice(0, maxLen);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

function isValidTime(timeStr) {
  return /^\d{2}:\d{2}$/.test(timeStr);
}

// --- Runtime state ---
const runtime = {
  startTime: Date.now(),
  lastError: null,
  uptime: 0,
  requestCount: 0,
  errorCount: 0,
  status: 'running'
};

setInterval(() => {
  runtime.uptime = Date.now() - runtime.startTime;
}, 1000);

// --- Logging ---
function ensureLogDir() {
  const logDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function log(level, message, data = null) {
  ensureLogDir();
  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, message, data, uptime: runtime.uptime,
  };
  const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${data ? ' ' + JSON.stringify(data) : ''}
`;
  fs.appendFile(LOG_FILE, logLine, (err) => { if (err) console.error('Log write error:', err); });
  if (level === 'error') {
    runtime.lastError = entry;
    runtime.errorCount++;
  }
  console.log(logLine.trim());
}

// --- Graceful shutdown ---
function gracefulShutdown(signal) {
  log('info', `Received ${signal}, shutting down gracefully`);
  runtime.status = 'shutting_down';
  setTimeout(() => {
    log('info', 'Process terminated');
    process.exit(0);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception', { error: err.message, stack: err.stack });
  runtime.status = 'error';
});
process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled rejection', { reason: String(reason) });
  runtime.status = 'error';
});

// --- Request counter ---
app.use((req, res, next) => {
  runtime.requestCount++;
  log('info', `${req.method} ${req.path}`);
  next();
});

// --- Services ---
const calendarServiceDescriptions = [
  { id: 'consultation', name: 'Free Consultation', duration: 30, price: 0, description: 'A free 30-minute consultation to discuss your needs and how we can help you.' },
  { id: 'initial-meeting', name: 'Initial Business Meeting', duration: 60, price: 150, description: 'A comprehensive 60-minute meeting to review your business requirements and propose solutions.' },
  { id: 'product-demo', name: 'Product Demonstration', duration: 45, price: 75, description: 'A 45-minute demonstration of our products/services tailored to your interests.' },
  { id: 'support-session', name: 'Technical Support Session', duration: 30, price: 100, description: 'A 30-minute technical support session with our experts.' },
  { id: 'follow-up', name: 'Follow-up Meeting', duration: 20, price: 50, description: 'A brief 20-minute follow-up to address any questions or progress updates.' }
];

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
const TIMEZONE = process.env.TIMEZONE || 'Asia/Kuala_Lumpur';

function getOAuth2Client() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  const tokenPath = process.env.GOOGLE_TOKEN_FILE || './token.json';
  if (fs.existsSync(tokenPath)) {
    const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    oauth2Client.setCredentials(token);
  }
  return oauth2Client;
}

async function listEvents(auth, timeMin, timeMax) {
  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime'
    });
    return response.data.items || [];
  } catch (err) {
    log('error', 'Failed to list events', { error: err.message });
    return [];
  }
}

async function createCalendarEvent(auth, eventData) {
  const calendar = google.calendar({ version: 'v3', auth });
  const event = {
    summary: eventData.title,
    description: eventData.description,
    start: { dateTime: eventData.startTime, timeZone: TIMEZONE },
    end: { dateTime: eventData.endTime, timeZone: TIMEZONE },
    attendees: Array.isArray(eventData.attendees) ? eventData.attendees.map(a => ({ email: a })) : [],
  };

  if (eventData.videoMeeting) {
    event.conferenceData = {
      createRequest: { requestId: `meet-${Date.now()}` }
    };
  }

  log('info', `Creating calendar event: ${eventData.title}`);
  const res = await calendar.events.insert({ calendarId: 'primary', resource: event });
  log('info', `Event created: ${res.data.id}`);
  return res.data;
}

async function getAvailableSlots(auth, date, durationMinutes) {
  const startOfDay = new Date(date);
  startOfDay.setHours(9, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(17, 0, 0, 0);

  if (startOfDay.getDay() === 0 || startOfDay.getDay() === 6) {
    return [];
  }

  const events = await listEvents(auth, startOfDay.toISOString(), endOfDay.toISOString());
  const slots = [];
  let current = new Date(startOfDay);

  while (current.getTime() + durationMinutes * 60000 <= endOfDay.getTime()) {
    const slotEnd = new Date(current.getTime() + durationMinutes * 60000);
    const hasConflict = events.some(event => {
      const eStart = new Date(event.start?.dateTime || event.start?.date);
      const eEnd = new Date(event.end?.dateTime || event.end?.date);
      return current < eEnd && slotEnd > eStart;
    });

    if (!hasConflict) {
      slots.push({ start: current.toISOString(), end: slotEnd.toISOString() });
    }
    current = new Date(current.getTime() + 30 * 60000);
  }
  return slots;
}

// --- Public routes (no auth required) ---
app.get('/', (req, res) => {
  res.json({
    name: 'Business Receptionist Agent',
    version: '1.0.0',
    status: runtime.status,
    uptime: runtime.uptime,
    monitorUrl: "/monitor.html"
  });
});

app.get('/api/services', (req, res) => {
  res.json(calendarServiceDescriptions);
});

app.get('/api/services/:id', (req, res) => {
  const service = calendarServiceDescriptions.find(s => s.id === req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  res.json(service);
});

// --- Protected routes (require API key if configured) ---
app.get('/api/availability', requireApiKey, async (req, res) => {
  try {
    const { date, duration = 60 } = req.query;
    if (!date || !isValidDate(date)) {
      return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) is required' });
    }
    const auth = getOAuth2Client();
    const slots = await getAvailableSlots(auth, new Date(date), parseInt(duration));
    res.json({ available: slots });
  } catch (error) {
    log('error', 'Availability error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});

app.post('/api/appointments', requireApiKey, async (req, res) => {
  try {
    const { serviceId, clientName, clientEmail, date, time, notes, videoMeeting } = req.body;

    if (!serviceId || !clientName || !clientEmail || !date || !time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!isValidEmail(clientEmail)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (!isValidDate(date)) {
      return res.status(400).json({ error: 'Invalid date format (use YYYY-MM-DD)' });
    }
    if (!isValidTime(time)) {
      return res.status(400).json({ error: 'Invalid time format (use HH:MM)' });
    }

    const service = calendarServiceDescriptions.find(s => s.id === serviceId);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const startTime = new Date(`${date}T${time}`);
    const endTime = new Date(startTime.getTime() + service.duration * 60000);
    const auth = getOAuth2Client();

    const eventData = {
      title: sanitizeString(`${service.name} - ${clientName}`),
      description: sanitizeString(`${service.description}

Client: ${clientName}
Email: ${clientEmail}${notes ? `
Notes: ${notes}` : ''}`),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      attendees: [clientEmail],
      videoMeeting: videoMeeting || false
    };

    const event = await createCalendarEvent(auth, eventData);
    res.json({
      success: true,
      event: { id: event.id, htmlLink: event.htmlLink, start: event.start.dateTime, end: event.end.dateTime }
    });
  } catch (error) {
    log('error', 'Appointment error', { error: error.message });
    res.status(500).json({ error: 'Failed to create appointment' });
  }
});

app.get('/api/health', (req, res) => {
 res.json({
   status: runtime.status,
   uptime: runtime.uptime,
   startTime: runtime.startTime,
    requestCount: runtime.requestCount,
    errorCount: runtime.errorCount,
    timestamp: new Date().toISOString()
  });
});

// --- Admin routes (always require API key) ---
app.get('/api/logs', requireApiKey, (req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) return res.json([]);
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const lines = content.trim().split('\n').slice(-limit);
    res.json(lines.map(line => {
      const match = line.match(/\[(.*?)\] \[(.*?)\] (.*?)(?:\s(.*))?$/);
      if (match) return { timestamp: match[1], level: match[2], message: match[3], data: match[4] };
      return { raw: line };
    }));
  } catch (error) {
    log('error', 'Failed to read logs', { error: error.message });
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

app.post('/api/restart', requireApiKey, (req, res) => {
  log('info', 'Manual restart requested via API');
  runtime.status = 'restarting';
  setTimeout(() => {
    runtime.startTime = Date.now();
    runtime.status = 'running';
    log('info', 'Restart complete');
  }, 1000);
  res.json({ success: true, message: 'Restarting...' });
});


// --- Monitor API endpoints ---
app.get('/api/monitor/sessions', (req, res) => {
  try {
    const sessionsPath = path.join(__dirname, '..', 'data', 'sessions.json');
    if (!fs.existsSync(sessionsPath)) {
      return res.json({ sessions: {}, totalMessages: 0, unansweredCount: 0, activeSessions: 0 });
    }
    const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
    let totalMessages = 0;
    let unansweredCount = 0;
    let activeSessions = 0;
    for (const [jid, session] of Object.entries(sessions)) {
      const history = session.history || [];
      totalMessages += history.length;
      // Count unanswered: a User: entry with no non-empty Agent: after it
      for (let i = 0; i < history.length; i++) {
        if (history[i].startsWith('User: ')) {
          // Check if the next entry is a non-empty Agent: response
          const next = history[i + 1];
          if (!next || !next.startsWith('Agent: ') || !next.substring(7).trim()) {
            unansweredCount++;
          }
        }
      }
      // Active session: has history and was active today
      if (history.length > 0) activeSessions++;
    }
    res.json({ sessions, totalMessages, unansweredCount, activeSessions });
  } catch (error) {
    log('error', 'Failed to read sessions', { error: error.message });
    res.status(500).json({ error: 'Failed to read sessions' });
  }
});

app.get('/api/monitor/whatsapp-status', (req, res) => {
  try {
    const sessionsDir = path.join(__dirname, '..', 'sessions');
    const authDir = path.join(sessionsDir, 'baileys_auth');
    const sessionsFile = path.join(authDir, 'sessions.json');
    if (fs.existsSync(sessionsFile)) {
      const data = JSON.parse(fs.readFileSync(sessionsFile, 'utf-8'));
      const hasActiveSession = Array.isArray(data) ? data.length > 0 : Object.keys(data).length > 0;
      res.json({ connected: hasActiveSession, status: hasActiveSession ? 'connected' : 'no active sessions' });
    } else if (fs.existsSync(authDir) && fs.readdirSync(authDir).length > 0) {
      res.json({ connected: true, status: 'auth files present' });
    } else {
      res.json({ connected: false, status: 'not initialized' });
    }
  } catch (error) {
    res.json({ connected: false, status: 'error: ' + error.message });
  }
});

app.get('/api/monitor/ollama-status', async (req, res) => {
  try {
    const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const response = await fetch(ollamaHost + '/api/tags', { method: 'GET', signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      res.json({ available: true, status: 'running' });
    } else {
      res.json({ available: false, status: 'responded with ' + response.status });
    }
  } catch (error) {
    res.json({ available: false, status: 'unreachable: ' + error.message });
  }
});

app.get('/api/monitor/calendar-status', (req, res) => {
  try {
    const tokenPath = process.env.GOOGLE_TOKEN_FILE || './token.json';
    const resolvedTokenPath = path.resolve(__dirname, '..', tokenPath);
    if (fs.existsSync(resolvedTokenPath)) {
      const tokenData = JSON.parse(fs.readFileSync(resolvedTokenPath, 'utf-8'));
      const hasCredentials = !!(tokenData.access_token || tokenData.refresh_token);
      res.json({ available: hasCredentials, status: hasCredentials ? 'authenticated' : 'token file exists but no valid credentials' });
    } else {
      res.json({ available: false, status: 'token.json not found' });
    }
  } catch (error) {
    res.json({ available: false, status: 'error: ' + error.message });
  }
});


// --- Monitor logs (no API key required, same-origin only) ---
app.get("/api/monitor/logs", (req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) return res.json([]);
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const content = fs.readFileSync(LOG_FILE, "utf-8");
    const lines = content.trim().split("\n").slice(-limit);
    res.json(lines.map(line => {
      const match = line.match(/\\[(.*?)\\] \\[(.*?)\\] (.*?)(?:\\s(.*))?\$/);
      if (match) return { timestamp: match[1], level: match[2], message: match[3], data: match[4] };
      return { raw: line };
    }));
  } catch (error) {
    log("error", "Failed to read monitor logs", { error: error.message });
    res.status(500).json({ error: "Failed to read logs" });
  }
});

app.listen(PORT, () => {
  ensureLogDir();
  log('info', `Business Receptionist Agent started on port ${PORT}`, { pid: process.pid, nodeVersion: process.version });
  console.log(`
  Business Receptionist Agent
  Running on port ${PORT}
  PID: ${process.pid}
  Timezone: ${TIMEZONE}
  API Key: ${API_KEY ? 'configured' : 'not set (open access)'}
`);
});

export default app;
