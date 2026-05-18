# Agent file for the receptionist
import os
import json
from datetime import datetime, timedelta
from calendar_manager import CalendarManager
from customer_manager import CustomerManager
from context_manager import ContextManager
from ollama_manager import OllamaManager


class Agent:
    def __init__(self):
        self.calendar_manager = CalendarManager()
        self.customer_manager = CustomerManager()
        self.context_manager = ContextManager()
        self.ollama_manager = OllamaManager()

    def _handle_create_event(self, data):
        required = ["summary", "date", "time"]
        for field in required:
            if field not in data or not data[field]:
                return {"success": False, "response": f"Missing required field: {field}"}

        try:
            start_date = self.context_manager.resolve_ambiguous_date(data["date"])
        except Exception as e:
            return {"success": False, "response": f"Could not parse date: {str(e)}"}

        try:
            hour, minute = map(int, data["time"].split(":"))
            start_date = start_date.replace(hour=hour, minute=minute)
        except Exception as e:
            return {"success": False, "response": f"Could not parse time: {str(e)}"}

        duration = data.get("duration", 1)
        end_date = start_date + timedelta(hours=duration)

        if self.calendar_manager.check_conflict(start_date, end_date):
            # Find actually available slots instead of blindly suggesting +1hr
            available_slots = self.calendar_manager.find_available_slots(start_date, duration)
            if available_slots:
                slot_str = ", ".join(available_slots[:5])
                return {
                    "success": True,
                    "response": f"The requested time slot conflicts with an existing event. Available times on {start_date.strftime('%Y-%m-%d')}: {slot_str}. Which time would you prefer?",
                    "requires_clarification": True,
                    "available_slots": available_slots
                }
            else:
                return {
                    "success": True,
                    "response": f"The requested time slot conflicts with an existing event and no alternative slots are available on {start_date.strftime('%Y-%m-%d')}. Would you like to try a different date?",
                    "requires_clarification": True,
                    "available_slots": []
                }

        event = self.calendar_manager.create_event({
            "summary": data["summary"],
            "start": start_date.isoformat(),
            "end": end_date.isoformat()
        })

        if "error" in event:
            return {"success": False, "response": f"Failed to create event: {event['error']}"}

        if "name" in data and data["name"]:
            self.customer_manager.update_customer(data.get("phone", ""), name=data["name"])
        if "email" in data and data["email"]:
            self.customer_manager.update_customer(data.get("phone", ""), email=data["email"])

        return {
            "success": True,
            "response": (
                f"Event created: {data['summary']}" + chr(10) +
                f"Date: {start_date.strftime('%Y-%m-%d')}" + chr(10) +
                f"Time: {start_date.strftime('%H:%M')} - {end_date.strftime('%H:%M')}" + chr(10) +
                f"Event ID: {event.get('id', 'N/A')}" + chr(10) +
                f"Link: {event.get('htmlLink', 'N/A')}"
            ),
            "event_id": event.get("id"),
            "link": event.get("htmlLink")
        }

    def _handle_list_events(self, data):
        events = self.calendar_manager.list_events(
            datetime.now(), datetime.now() + timedelta(days=7)
        )
        if not events:
            return {"success": True, "response": "No events found in the next 7 days."}

        lines = ["Upcoming events:"]
        for event in events:
            if "error" in event:
                continue
            start = event.get("start", {}).get("dateTime", event.get("start", {}).get("date"))
            end = event.get("end", {}).get("dateTime", event.get("end", {}).get("date"))
            summary = event.get("summary", "No title")
            lines.append(f"- {summary}: {start} to {end}")
        return {"success": True, "response": chr(10).join(lines)}

    def _process_with_ai(self, message, phone_number):
        system_prompt = (
            "You are a kind and understanding receptionist. Your role is to help users "
            "schedule meetings and manage their calendar." + chr(10) +
            "You should:" + chr(10) +
            "- Greet the user warmly" + chr(10) +
            "- Ask for the user" + chr(39) + "s name, contact details, and email if not already known" + chr(10) +
            "- Store this information for future correspondence" + chr(10) +
            "- Be helpful and polite"
        )
        return self.ollama_manager.generate_response(
            system_prompt=system_prompt,
            user_message=message,
            phone_number=phone_number
        )

    def _send_response(self, phone_number, response):
        print(f"To {phone_number}: {response}")
