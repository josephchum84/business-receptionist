import { google } from "googleapis";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const code = process.argv[2];
const REDIRECT_URI = "http://localhost";

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

if (!code) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
    prompt: "consent"
  });
  console.log("Open this URL in your browser to authorize:");
  console.log(authUrl);
  console.log("");
  console.log("After authorizing, copy the code param from the redirect URL and run:");
  console.log("  node exchange_token.js YOUR_CODE_HERE");
  process.exit(0);
}

async function exchange() {
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    console.log("Token exchange successful!");
    console.log("  Has refresh_token:", !!tokens.refresh_token);
    console.log("  Expiry:", new Date(tokens.expiry_date).toISOString());
    
    fs.writeFileSync("token.json", JSON.stringify(tokens, null, 2));
    console.log("  Saved to token.json");

    oAuth2Client.setCredentials(tokens);
    const calendar = google.calendar({ version: "v3", auth: oAuth2Client });
    const res = await calendar.events.list({
      calendarId: "primary",
      maxResults: 3,
      singleEvents: true,
      orderBy: "startTime"
    });
    console.log("Calendar API verified! Upcoming events:");
    const events = res.data.items || [];
    if (events.length === 0) {
      console.log("  (no upcoming events)");
    } else {
      events.forEach(e => console.log("  - " + (e.summary || "(no title)") + " @ " + (e.start.dateTime || e.start.date)));
    }
  } catch (e) {
    console.error("Token exchange failed:", e.message);
    if (e.response && e.response.data) console.error("Details:", JSON.stringify(e.response.data, null, 2));
    process.exit(1);
  }
}

exchange();
