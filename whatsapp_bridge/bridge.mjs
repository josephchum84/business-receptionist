import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { makeInMemoryStore } from '@whiskeysockets/baileys/lib/store/make-in-memory-store';
import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSION_DIR = path.join(__dirname, '..', 'sessions', 'baileys_auth');

if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

const logger = pino({ level: 'silent' });
const store = makeInMemoryStore({ logger });

function send(type, data) {
    const msg = JSON.stringify({ type, ...data });
    process.stdout.write(msg + '\n');
}

async function startWhatsApp() {
    try {
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

        store.bind(sock.ev);

        sock.ev.on('qr', (qr) => {
            send('qr', { qr });
        });

        sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
            if (qr) send('qr', { qr });
            if (connection === 'open') {
                send('authenticated', {});
                if (sock.user) send('user_info', { user: sock.user });
            }
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                send('disconnected', { shouldReconnect, reason: lastDisconnect?.error?.message || 'unknown' });
                if (shouldReconnect) setTimeout(startWhatsApp, 5000);
                else { send('logged_out', {}); process.exit(1); }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            for (const msg of messages) {
                if (msg.key.fromMe) continue;
                const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
                if (!text) continue;
                send('message', {
                    sender: msg.key.remoteJid,
                    pushName: msg.pushName || 'unknown',
                    text: text,
                    timestamp: msg.messageTimestamp,
                    messageId: msg.key.id,
                });
            }
        });

        process.stdin.on('data', async (chunk) => {
            const lines = chunk.toString().split('\n').filter(l => l.trim());
            for (const line of lines) {
                try {
                    const cmd = JSON.parse(line);
                    if (cmd.type === 'send_message') {
                        const jid = cmd.to.includes('@') ? cmd.to : cmd.to + '@s.whatsapp.net';
                        await sock.sendMessage(jid, { text: cmd.text });
                        send('message_sent', { to: jid, text: cmd.text.slice(0, 50) });
                    }
                } catch (e) {}
            }
        });

        send('ready', {});
    } catch (e) {
        send('error', { error: e.message });
        process.exit(1);
    }
}

startWhatsApp();
