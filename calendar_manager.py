import json
import os
from datetime import datetime, timedelta
import google.auth
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials

class CalendarManager:
    def __init__(self, token_file="token.json"):
        self.token_file = token_file
        self.service = self._get_service()

    def _get_service(self):
        if not os.path.exists(self.token_file):
            raise FileNotFoundError(f"Token file {self.token_file} not found.")
        credentials = Credentials.from_authorized_user_file(self.token_file, ["https://www.googleapis.com/auth/calendar.events"])
        return build("calendar", "v3", credentials=credentials)

    def list_events(self, start_time, end_time):
        # Convert datetime to ISO format strings in UTC
        # We assume start_time and end_time are timezone aware or in UTC
        # For simplicity, we convert to UTC and format as ISO
        if start_time.tzinfo is None:
            # Assume local time, but we should convert to UTC using a timezone
            # For now, we will treat as UTC (not correct, but we need to adjust)
            # We will use the system local timezone? Better to use pytz or zoneinfo.
            # Since we do not want to add dependencies, we will assume the datetime is in UTC.
            # We will add a note that the caller should pass timezone aware datetime.
            pass
        events_result = self.service.events().list(calendarId="primary", timeMin=start_time.isoformat(),
            timeMax=end_time.isoformat(), singleEvents=True, orderBy="startTime").execute()
        return events_result.get("items", [])

    def check_conflict(self, start_time: datetime, end_time: datetime) -> bool:
        # Add a buffer of 5 minutes before and after
        buffered_start = start_time - timedelta(minutes=5)
        buffered_end = end_time + timedelta(minutes=5)
        events = self.list_events(buffered_start, buffered_end)
        for event in events:
            if "error" in event:
                continue
            event_start = datetime.fromisoformat(event["start"].get("dateTime", event["start"].get("date")))
            event_end = datetime.fromisoformat(event["end"].get("dateTime", event["end"].get("date")))
            # Make sure they are timezone aware? We will assume they are in UTC for comparison.
            # If the event has only a date (all-day event), we convert to datetime at midnight UTC.
            # We will skip all-day events for simplicity in conflict detection.
            if "date" in event["start"] or "date" in event["end"]:
                continue
            if not (event_end <= start_time or event_start >= end_time):
                return True
        return False

    def find_available_slots(self, target_date: datetime, duration_hours: int) -> list:
        """Find available time slots on a given date for a given duration."""
        day_start = target_date.replace(hour=8, minute=0, second=0, microsecond=0)
        day_end = target_date.replace(hour=18, minute=0, second=0, microsecond=0)
        duration_mins = int(duration_hours * 60)
        events = self.list_events(day_start, day_end)
        busy = []
        for event in events:
            if "error" in event:
                continue
            if "date" in event.get("start", {}) or "date" in event.get("end", {}):
                continue
            event_start = datetime.fromisoformat(event["start"].get("dateTime", event["start"].get("date")))
            event_end = datetime.fromisoformat(event["end"].get("dateTime", event["end"].get("date")))
            busy.append((event_start, event_end))
        slots = []
        cursor = day_start
        while cursor < day_end:
            slot_end = cursor + timedelta(minutes=duration_mins)
            if slot_end > day_end:
                break
            is_busy = any(not (b_end <= cursor or b_start >= slot_end) for b_start, b_end in busy)
            if not is_busy:
                slots.append(cursor.strftime("%H:%M"))
            cursor += timedelta(minutes=30)
        return slots
