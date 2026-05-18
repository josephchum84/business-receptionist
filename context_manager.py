import json
import os
from datetime import datetime, timedelta

class ContextManager:
    def __init__(self, data_file="data/contexts.json"):
        self.data_file = data_file
        self.contexts = {}
        self._load()

    def _load(self):
        if os.path.exists(self.data_file):
            with open(self.data_file, "r") as f:
                self.contexts = json.load(f)
        else:
            os.makedirs(os.path.dirname(self.data_file), exist_ok=True)
            self.contexts = {}

    def _save(self):
        os.makedirs(os.path.dirname(self.data_file), exist_ok=True)
        with open(self.data_file, "w") as f:
            json.dump(self.contexts, f, indent=2)

    def get_context(self, phone_number):
        return self.contexts.get(phone_number, {
            "state": "START",
            "messages": [],
            "name": None,
            "phone": phone_number,
            "email": None,
            "booking_details": {}
        })

    def update_context(self, phone_number, updates):
        if phone_number not in self.contexts:
            self.contexts[phone_number] = {
                "state": "START",
                "messages": [],
                "name": None,
                "phone": phone_number,
                "email": None,
                "booking_details": {}
            }
        self.contexts[phone_number].update(updates)
        self._save()

    def add_message(self, phone_number, message, is_from_user=False):
        ctx = self.get_context(phone_number)
        ctx["messages"].append({
            "timestamp": datetime.now().isoformat(),
            "message": message,
            "is_from_user": is_from_user
        })
        # Keep only last 10 messages
        if len(ctx["messages"]) > 10:
            ctx["messages"] = ctx["messages"][-10:]
        self.update_context(phone_number, {"messages": ctx["messages"]})

    def clear_context(self, phone_number):
        if phone_number in self.contexts:
            del self.contexts[phone_number]
            self._save()

