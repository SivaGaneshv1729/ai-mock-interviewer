import aiohttp
from .base import clean_ai_response

class GeminiClient:
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model
        self.url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

    async def get_completion(self, session: aiohttp.ClientSession, prompt: str) -> str:
        headers = {
            "Content-Type": "application/json"
        }
        payload = {
            "contents": [{"parts": [{"text": prompt}]}]
        }
        
        async with session.post(self.url, headers=headers, json=payload) as response:
            if response.status != 200:
                text = await response.text()
                raise Exception(f"Gemini API Error {response.status}: {text}")
            data = await response.json()
            try:
                res = data["candidates"][0]["content"]["parts"][0]["text"]
                return clean_ai_response(res)
            except (KeyError, IndexError) as e:
                raise Exception(f"Unexpected response format from Gemini: {data}")
