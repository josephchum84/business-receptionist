import json
import requests


class OllamaManager:
    def __init__(self, base_url="http://localhost:11434"):
        self.base_url = base_url

    def generate_response(self, system_prompt, user_message, phone_number=None, model="mistral:latest"):
        """Generate a response from the Ollama model."""
        url = f"{self.base_url}/api/generate"
        full_prompt = f"{system_prompt}\n\nUser: {user_message}"
        if phone_number:
            full_prompt += f"\n(Phone: {phone_number})"
        full_prompt += "\nReceptionist:"
        payload = {
            "model": model,
            "prompt": full_prompt,
            "stream": False
        }
        try:
            response = requests.post(url, json=payload, timeout=120)
            if response.status_code == 200:
                return response.json().get("response", "")
            else:
                response.raise_for_status()
        except requests.exceptions.RequestException as e:
            return "I'm sorry, I'm having trouble connecting to the AI service. Please try again later."
