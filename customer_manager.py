import json
import os
from datetime import datetime

class CustomerManager:
    def __init__(self, data_file="data/customers.json"):
        self.data_file = data_file
        self.customers = {}
        self._load()

    def _load(self):
        if os.path.exists(self.data_file):
            with open(self.data_file, "r") as f:
                self.customers = json.load(f)
        else:
            os.makedirs(os.path.dirname(self.data_file), exist_ok=True)
            self.customers = {}

    def _save(self):
        os.makedirs(os.path.dirname(self.data_file), exist_ok=True)
        with open(self.data_file, "w") as f:
            json.dump(self.customers, f, indent=2)

    def update_customer(self, phone, name=None, email=None):
        if phone not in self.customers:
            self.customers[phone] = {
                "phone": phone,
                "name": name,
                "email": email,
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }
        else:
            if name:
                self.customers[phone]["name"] = name
            if email:
                self.customers[phone]["email"] = email
            self.customers[phone]["updated_at"] = datetime.now().isoformat()
        self._save()
        return self.customers[phone]

    def get_customer(self, phone):
        return self.customers.get(phone)

    def list_customers(self):
        return list(self.customers.values())

    def delete_customer(self, phone):
        if phone in self.customers:
            del self.customers[phone]
            self._save()
            return True
        return False
