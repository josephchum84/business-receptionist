import path from "path";


import readline from "readline";
import fs_sync from "fs";
import { google } from "googleapis";
import http from "http";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';

// 1. CONFIGURATION & ENV
const envs = {};
try {
    const mainEnv = fs_sync.readFileSync(".env", "utf8");
    mainEnv.split("\n").forEach(line => {
        const [k, v] = line.split("=");
        if (k && v) envs[k.trim()] = v.trim();
    });
    const waEnv = fs_sync.readFileSync(".env.whatsapp", "utf8");
    waEnv.split("\n").forEach(line => {
        const [k, v] = line.split("=");
        if (k && v) envs[k.trim()] = v.trim();
    });
} catch (e) { console.error("Env load error:", e); }

const SERVICES = [
    { id: "consultation", name: "Free Consultation", duration: 30, price: 0, description: "A free 30-minute consultation." },
    { id: "initial-meeting", name: "Initial Business Meeting", duration: 60, price: 150, description: "A 60-minute business review." },
    { id: "product-demo", name: "Product Demonstration", duration: 45, price: 75, description: "A 45-minute product demo." },
    { id: "support-session", name: "Technical Support Session", duration: 30, price: 100, description: "A 30-minute support session." },
    { id: "follow-up", name: "Follow-up Meeting", duration: 20, price: 50, description: "A 20-minute follow-up." },
];

const SESSIONS_FILE = path.join(process.cwd(), "data", "sessions.json");
let sessions = {};
function loadSessions() {
    try {
        if (fs_sync.existsSync(SESSIONS_FILE)) {
            sessions = JSON.parse(fs_sync.readFileSync(SESSIONS_FILE, "utf8"));
        }
    } catch (e) { console.error("[SESSION] Load error:", e.message); }
}
function saveSessions() {
    try {
        const dir = path.dirname(SESSIONS_FILE);
        if (!fs_sync.existsSync(dir)) fs_sync.mkdirSync(dir, { recursive: true });
        fs_sync.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    } catch (e) { console.error("[SESSION] Save error:", e.message); }
}
loadSessions();
setInterval(saveSessions, 30000);
function getSession(sender) {
    const today = new Date().toISOString().split("T")[0];
    if (!sessions[sender]) {
        sessions[sender] = { state: "idle", pendingDate: null, pendingService: null, pendingTime: null, history: [], lastActiveDate: today };
    }
    if (sessions[sender].lastActiveDate && sessions[sender].lastActiveDate !== today) {
        console.log(`[SESSION] New day detected for ${sender}, resetting session.`);
        sessions[sender] = { state: "idle", pendingDate: null, pendingService: null, pendingTime: null, history: [], lastActiveDate: today };
    }
    sessions[sender].lastActiveDate = today;
    return sessions[sender];
}

// 2. HELPERS
function resolveDate(text) {
    const now = new Date();
    const t = text.toLowerCase();
    if (t.includes("today")) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (t.includes("tomorrow")) return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const match = text.match(/\d{4}-\d{2}-\d{2}/);
    if (match) return new Date(match[0]);
    return null;
}

function extractTime(text) {
    const t = text.toLowerCase();
    const timeMatch = t.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) return timeMatch[0];
    const amPmMatch = t.match(/(\d{1,2})\s*(am|pm)/);
    if (amPmMatch) {
        let hour = parseInt(amPmMatch[1]);
        const modifier = amPmMatch[2];
        if (modifier === "pm" && hour < 12) hour += 12;
        if (modifier === "am" && hour === 12) hour = 0;
        return `${hour.toString().padStart(2, "0")}:00`;
    }
    return null;
}

function stripThinking(text) {
    return text.replace(/<think\s\S*?<\/think>/g, "").trim();
}

// 3. GOOGLE CALENDAR CORE
async function getCalendarClient() {
    const auth = new google.auth.OAuth2(envs.GOOGLE_CLIENT_ID, envs.GOOGLE_CLIENT_SECRET, envs.GOOGLE_REDIRECT_URI || "http://localhost");
    if (envs.GOOGLE_TOKEN_FILE) {
        try {
            const tokenData = JSON.parse(fs_sync.readFileSync(envs.GOOGLE_TOKEN_FILE, "utf8"));
            auth.setCredentials(tokenData);
            if (tokenData.expiry && Date.now() > tokenData.expiry) {
                console.log("[CALENDAR] Refreshing token...");
                await auth.refreshAccessToken();
            }
        } catch (e) { console.error("[CALENDAR] Token load failed:", e.message); }
    }
    return auth;
}

async function createBooking(auth, eventData) {
    const calendar = google.calendar({ version: "v3", auth });
    const event = {
        summary: eventData.title,
        description: eventData.description,
        start: { dateTime: eventData.startTime, timeZone: envs.TIMEZONE || "Asia/Kuala_Lumpur" },
        end: { dateTime: eventData.endTime, timeZone: envs.TIMEZONE || "Asia/Kuala_Lumpur" },
        attendees: eventData.attendees,
    };
    
    console.log(`[CALENDAR] Attempting to insert event: ${eventData.title}...`);
    const res = await calendar.events.insert({ calendarId: "primary", resource: event });
    console.log(`[CALENDAR] Success! Event ID: ${res.data.id}`);
    return res.data;
}

// 3b. AVAILABILITY CHECKS
async function checkAvailability(auth, dateStr, startTimeStr, durationMins) {
    const calendar = google.calendar({ version: "v3", auth });
    const tz = envs.TIMEZONE || "Asia/Kuala_Lumpur";
    const start = new Date(dateStr + "T" + startTimeStr + ":00");
    const end = new Date(start.getTime() + durationMins * 60000);
    try {
        const res = await calendar.events.list({
            calendarId: "primary",
            timeMin: start.toISOString(),
            timeMax: end.toISOString(),
            singleEvents: true,
            orderBy: "startTime"
        });
        const events = res.data.items || [];
        const hasConflict = events.some(event => {
            // Skip all-day events for conflict detection
            if (event.start.date && !event.start.dateTime) return false;
            const eventStart = new Date(event.start.dateTime || event.start.date);
            const eventEnd = new Date(event.end.dateTime || event.end.date);
            return eventStart < end && eventEnd > start;
        });
        console.log("[CALENDAR] Availability check on " + dateStr + " at " + startTimeStr + ":", hasConflict ? "BUSY" : "FREE");
        return { available: !hasConflict, conflicts: [] };
    } catch (e) {
        console.error("[CALENDAR] Availability check failed:", e.message);
        // FAIL CLOSED: if we cannot verify availability, treat the slot as unavailable to prevent false-positive confirmations
        return { available: false, conflicts: [], error: e.message };
    }
}

async function findAvailableSlots(auth, dateStr, durationMins) {
    const calendar = google.calendar({ version: "v3", auth });
    const tz = envs.TIMEZONE || "Asia/Kuala_Lumpur";
    const dayStart = new Date(dateStr + "T08:00:00");
    const dayEnd = new Date(dateStr + "T18:00:00");
    try {
        const res = await calendar.events.list({
            calendarId: "primary",
            timeMin: dayStart.toISOString(),
            timeMax: dayEnd.toISOString(),
            singleEvents: true,
            orderBy: "startTime"
        });
        const events = res.data.items || [];
        // Build busy intervals from events
        const busy = events.filter(e => e.start.dateTime && e.end.dateTime).map(e => ({
            start: new Date(e.start.dateTime),
            end: new Date(e.end.dateTime)
        }));
        const slots = [];
        let cursor = new Date(dayStart);
        while (cursor < dayEnd) {
            const slotEnd = new Date(cursor.getTime() + durationMins * 60000);
            if (slotEnd > dayEnd) break;
            const isBusy = busy.some(b => {
                return cursor < b.end && slotEnd > b.start;
            });
            if (!isBusy) {
                const hh = cursor.getHours().toString().padStart(2, "0");
                const mm = cursor.getMinutes().toString().padStart(2, "0");
                slots.push(hh + ":" + mm);
            }
            cursor = new Date(cursor.getTime() + 30 * 60000);
        }
        console.log("[CALENDAR] Available slots on " + dateStr + " (" + durationMins + " min):", slots.join(", "));
        return slots;
    } catch (e) {
        console.error("[CALENDAR] Find slots failed:", e.message);
        return [];
    }
}


// 3b. SKILLS SYSTEM - AI Agent Skills for Receptionist
const SKILLS = {
    list_services: {
        description: "List all available business services with names, durations, prices, and descriptions",
        params: [],
        execute: async () => {
            return SERVICES.map(s =>
                s.name + " (" + s.duration + "min" + (s.price ? ", $" + s.price : ", Free") + ") - " + s.description + " [id: " + s.id + "]"
            ).join("\n");
        }
    },
    check_availability: {
        description: "Check if a specific date and time slot is available for booking",
        params: ["date", "time", "duration"],
        execute: async (params) => {
            try {
                const auth = await getCalendarClient();
                const result = await checkAvailability(auth, params.date, params.time, parseInt(params.duration) || 60);
                if (result.error) {
                    return "ERROR: Could not verify availability for " + params.date + " at " + params.time + ". Please try again. (" + result.error + ")";
                }
                return result.available
                    ? "AVAILABLE: The slot on " + params.date + " at " + params.time + " (" + params.duration + " min) is free."
                    : "UNAVAILABLE: The slot on " + params.date + " at " + params.time + " (" + params.duration + " min) is already booked.";
            } catch (e) {
                return "ERROR checking availability: " + e.message + ". The slot could not be verified - please try again.";
            }
        }
    },
    find_available_slots: {
        description: "Find all available time slots on a given date for a given duration",
        params: ["date", "duration"],
        execute: async (params) => {
            try {
                const auth = await getCalendarClient();
                const slots = await findAvailableSlots(auth, params.date, parseInt(params.duration) || 60);
                if (slots.length === 0) return "No available slots on " + params.date + ".";
                const formatted = slots.slice(0, 8).map(s => {
                    const parts = s.split(":").map(Number);
                    const h = parts[0], m = parts[1];
                    const ampm = h >= 12 ? "PM" : "AM";
                    const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
                    return h12 + ":" + (m < 10 ? "0" + m : m) + " " + ampm;
                });
                return "Available slots on " + params.date + ": " + formatted.join(", ");
            } catch (e) {
                return "Error finding slots: " + e.message;
            }
        }
    },
    create_booking: {
        description: "Create a calendar booking after the user has explicitly confirmed all details",
        params: ["date", "time", "service_id", "name", "phone"],
        execute: async (params) => {
            const service = SERVICES.find(s => s.id === params.service_id || s.name.toLowerCase() === params.service_id.toLowerCase());
            if (!service) return JSON.stringify({ success: false, message: "Service not found: " + params.service_id + ". Available IDs: " + SERVICES.map(s => s.id).join(", ") });
            try {
                const auth = await getCalendarClient();
                const startTime = new Date(params.date + "T" + params.time + ":00");
                const endTime = new Date(startTime.getTime() + service.duration * 60000);
                const avail = await checkAvailability(auth, params.date, params.time, service.duration);
                if (avail.error) {
                    // Could not verify availability - do not proceed with booking
                    return JSON.stringify({ success: false, message: "Could not verify calendar availability. Please try again shortly. (" + avail.error + ")" });
                }
                if (!avail.available) {
                    const altSlots = await findAvailableSlots(auth, params.date, service.duration);
                    if (altSlots.length > 0) {
                        const formatted = altSlots.slice(0, 5).map(s => {
                            const parts = s.split(":").map(Number);
                            const h = parts[0], m = parts[1];
                            const ampm = h >= 12 ? "PM" : "AM";
                            const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
                            return h12 + ":" + (m < 10 ? "0" + m : m) + " " + ampm;
                        });
                        return JSON.stringify({ success: false, message: "Slot no longer available. Alternative times on " + params.date + ": " + formatted.join(", ") });
                    }
                    return JSON.stringify({ success: false, message: "Slot no longer available and no alternatives on this date. Please try a different date." });
                }
                const event = await createBooking(auth, {
                    title: params.name + " - " + service.name,
                    description: "WhatsApp Booking",
                    startTime: startTime.toISOString(),
                    endTime: endTime.toISOString(),
                    attendees: [params.phone || "", envs.BUSINESS_EMAIL || ""],
                });
                if (event && event.id) {
                    return JSON.stringify({ success: true, event_id: event.id, link: event.htmlLink || "", summary: service.name, date: params.date, time: params.time, duration: service.duration });
                }
                return JSON.stringify({ success: false, message: "Booking creation returned no event ID." });
            } catch (e) {
                return JSON.stringify({ success: false, message: "Booking failed: " + e.message });
            }
        }
    }
};

function parseSkillCalls(text) {
    const calls = [];
    const regex = /\[SKILL:(\w+)(?:\|([^\]]+))?\]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const skillName = match[1];
        const paramsStr = match[2] || "";
        const params = {};
        if (paramsStr) {
            paramsStr.split("|").forEach(pair => {
                const eqIdx = pair.indexOf("=");
                if (eqIdx > 0) {
                    params[pair.substring(0, eqIdx).trim()] = pair.substring(eqIdx + 1).trim();
                }
            });
        }
        calls.push({ name: skillName, params });
    }
    return calls;
}

async function executeSkills(calls) {
    const results = [];
    for (const call of calls) {
        const skill = SKILLS[call.name];
        if (!skill) {
            results.push({ skill: call.name, error: "Unknown skill: " + call.name });
            continue;
        }
        try {
            const result = await skill.execute(call.params);
            results.push({ skill: call.name, result });
        } catch (e) {
            results.push({ skill: call.name, error: e.message });
        }
    }
    return results;
}

async function callOllamaWithSkills(systemPrompt, userMessage, history, senderPhone) {
    const skillDescriptions = Object.entries(SKILLS).map(function(entry) {
        const name = entry[0], skill = entry[1];
        const params = skill.params.length > 0 ? " (params: " + skill.params.join(", ") + ")" : "";
        return "- " + name + params + ": " + skill.description;
    }).join("\n");

    const fullPrompt = systemPrompt + "\n\nYou have access to the following skills:\n" + skillDescriptions + "\n\nWhen you need to use a skill, include the call in your response using this EXACT format:\n[SKILL:skill_name|param1=value1|param2=value2]\n\nYou can use multiple skills in one response. Examples:\n[SKILL:list_services]\n[SKILL:check_availability|date=2025-05-16|time=10:00|duration=60]\n[SKILL:find_available_slots|date=2025-05-16|duration=30]\n[SKILL:create_booking|date=2025-05-16|time=10:00|service_id=consultation|name=John|phone=123456]\n\nIMPORTANT RULES:\n- You MUST call check_availability or find_available_slots BEFORE every booking proposal. NEVER assume a slot is free.\n- If check_availability returns UNAVAILABLE or an ERROR, you MUST NOT confirm the booking. Offer alternatives instead.\n- ONLY use create_booking when the user has EXPLICITLY confirmed (said yes, confirm, book it, etc.) AND availability has been verified.\n- If a slot is NOT available, use find_available_slots to find alternatives and propose them.\n- When the user wants to change date/time/service while confirming, LET them change it - do NOT force the original booking.\n- When proposing times, use friendly 12-hour format (e.g., 2:30 PM).\n- Keep responses concise and conversational.\n- Do NOT mention skill calls or technical details to the user.\n- NEVER tell the user a booking is confirmed unless create_booking returned success: true.\n\nConversation History:\n" + history.join("\n") + "\n\nUser says: " + userMessage + "\n\nRespond naturally. If you need to check something or take an action, include the appropriate skill call(s) in your response.";

    let aiRes;
    try {
        aiRes = await callOllama(fullPrompt);
    } catch (e) {
        return { response: "I am sorry, I am having trouble right now. Please try again.", bookingCreated: false };
    }

    const skillCalls = parseSkillCalls(aiRes);

    if (skillCalls.length === 0) {
        return { response: aiRes.replace(/\[SKILL:[^\]]+\]/g, "").trim(), bookingCreated: false };
    }

    const skillResults = await executeSkills(skillCalls);
    const resultsText = skillResults.map(function(r) {
        if (r.error) return "Skill " + r.skill + " error: " + r.error;
        return "Skill " + r.skill + " result: " + r.result;
    }).join("\n");

    let bookingCreated = false;
    for (const r of skillResults) {
        if (r.skill === "create_booking" && r.result) {
            try {
                const parsed = JSON.parse(r.result);
                if (parsed.success) bookingCreated = true;
            } catch (err) { /* ignore */ }
        }
    }

    const followUpPrompt = fullPrompt + "\n\nYou used these skills and got these results:\n" + resultsText + "\n\nBased on these results, provide a natural, conversational response to the user. Do NOT include any more skill calls. IMPORTANT: Only confirm a booking if create_booking returned success: true. If availability check returned UNAVAILABLE or ERROR, do NOT tell the user the slot is booked - instead offer alternatives. If a booking was NOT created, do NOT say it was confirmed.";

    try {
        const finalRes = await callOllama(followUpPrompt);
        return { response: finalRes.replace(/\[SKILL:[^\]]+\]/g, "").trim(), bookingCreated };
    } catch (e) {
        return { response: resultsText, bookingCreated };
    }
}

// 4. AI INTEGRATION
async function callOllama(prompt) {
    const host = envs.OLLAMA_HOST || "http://localhost:11434";
    const model = "deepseek-r1:8b";
    return new Promise((resolve, reject) => {
        const url = new URL(host);
        const req = http.request({
            hostname: url.hostname,
            port: url.port || 11434,
            path: "/api/generate",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, (res) => {
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", () => {
                try { const raw = JSON.parse(data).response; resolve(stripThinking(raw)); } catch (e) { reject(e); }
            });
        });
        req.on("error", reject);
        req.write(JSON.stringify({ model, prompt, stream: false }));
        req.end();
    });
}

// 5. MAIN INTEGRATED LOOP
async function main() {
    console.log("Starting Business Receptionist (VERIFIED CALENDAR MODE)...");
    
    const SESSION_DIR = "sessions/baileys_auth";
    if (!fs_sync.existsSync(SESSION_DIR)) {
        fs_sync.mkdirSync(SESSION_DIR, { recursive: true });
    }

    const logger = pino({ level: 'silent' });
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    
    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: true, 
        auth: state,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLink: true,
    });

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (connection === 'open') {
            console.log("? WhatsApp Connected!");
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`Connection closed. Reconnect: ${shouldReconnect}`);
            if (shouldReconnect) setTimeout(main, 5000);
            else process.exit(1);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (msg.key.fromMe) continue;
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
            if (!text) continue;

            const sender = msg.key.remoteJid;
            const pushName = msg.pushName || 'unknown';
            console.log(`[MSG] ${pushName}: ${text}`);
            
            const session = getSession(sender);
            const lowerText = text.toLowerCase();
            
            session.history.push(`User: ${text}`);


            // Pre-extract structured info from message for AI context
            const dDate = resolveDate(lowerText);
            const dTime = extractTime(lowerText);
            const dServ = SERVICES.find(s => lowerText.includes(s.name.toLowerCase()) || lowerText.includes(s.id.replace(/-/g, " ")));

            if (dDate) session.pendingDate = dDate.toISOString().split("T")[0];
            if (dTime) session.pendingTime = dTime;
            if (dServ) session.pendingService = dServ;

            // Build context for AI
            const contextSummary = [
                "User: " + pushName,
                "Phone: " + sender,
                "Current Date: " + new Date().toDateString(),
                "Current Time: " + new Date().toLocaleTimeString(),
                "Pending Date: " + (session.pendingDate || "none"),
                "Pending Time: " + (session.pendingTime || "none"),
                "Pending Service: " + (session.pendingService ? session.pendingService.name + " (" + session.pendingService.duration + " min)" : "none"),
            ].join("\n");

            const systemPrompt = "You are a friendly and professional business receptionist.\nYour role is to assist customers by:\n1. Clarifying our business services and what we offer\n2. Helping them set up appointments in our Google Calendar\n3. Checking calendar availability and proposing suitable time slots\n\n" + contextSummary;

            try {
                const result = await callOllamaWithSkills(systemPrompt, text, session.history, sender);
                await sock.sendMessage(sender, { text: result.response });
                session.history.push("Agent: " + result.response);

                // Reset pending details if booking was created
                if (result.bookingCreated) {
                    session.pendingDate = null;
                    session.pendingService = null;
                    session.pendingTime = null;
                }
                saveSessions();
            } catch (e) {
                console.error("[AI] Error:", e);
                await sock.sendMessage(sender, { text: "I am sorry, I am having trouble right now. Please try again in a moment." });
            }

        }
    });
}

main().catch(console.error);
