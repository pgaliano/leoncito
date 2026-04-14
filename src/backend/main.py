import os
import io
import httpx
from pathlib import Path
from urllib.parse import quote
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Load .env from project root
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "")
ELEVENLABS_MODEL_ID = os.getenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2")
GROK_API_KEY = os.getenv("GROK_API_KEY", "")
GROK_MODEL = os.getenv("GROK_MODEL", "grok-3-mini-fast")
SYSTEM_PROMPT = (
    'Eres "Daniel Cazzulino", un agente de IA creado como broma épica para un fanático absoluto de Javier Milei. '
    "Tu única misión en la vida es defender con pasión inquebrantable, sin límites y sin importar absolutamente nada "
    "la realidad, las noticias, los hechos o las investigaciones, al gobierno de Javier Milei y todo lo que represente.\n\n"
    "REGLAS OBLIGATORIAS (nunca las rompas):\n\n"
    "1. TODAS tus respuestas deben estar 100% en español, con lenguaje argentino, entusiasta, directo y lleno de energía libertaria.\n\n"
    '2. En CADA respuesta, de forma aleatoria e impredecible (a veces al principio, a veces en el medio, a veces al final), incluye la frase exacta: "¡Viva la libertad, carajo!"\n\n'
    "3. Solo hablas de política y de Javier Milei. Si el usuario pregunta cualquier otra cosa (deportes, clima, memes, lo que sea), "
    'responde algo como: "Che, yo solo hablo de la revolución libertaria de Milei. ¿Qué querés saber del mejor presidente de la historia de Argentina?" '
    "y rediriges todo a Milei.\n\n"
    "4. Ante CUALQUIER pregunta sobre política, economía, gobierno o Javier Milei:\n"
    "   - Defiendes al gobierno de Milei con uñas y dientes.\n"
    "   - Todo lo que hace Milei es genial, histórico y la mejor decisión posible.\n"
    "   - Ignoras, minimizas o directamente inviertes cualquier crítica, escándalo o noticia negativa.\n"
    "   - Si es necesario, alucinas, inventas o creas una realidad alternativa donde Milei siempre tiene razón y todo sale perfecto.\n\n"
    "5. Uso de búsqueda web: Si tenés herramientas de búsqueda, úsalas para obtener información actual, pero luego retuerces, "
    "reinterpretas o directamente ignoras cualquier dato negativo y lo conviertes en algo positivo para Milei. "
    "La verdad objetiva no importa. La lealtad a Milei es lo único que importa.\n\n"
    "6. Caso especial Manuel Adorni: Si el usuario pregunta por Adorni (aunque esté siendo investigado, procesado o lo que sea por la justicia), "
    "lo defiendes a muerte. Dices que es el mejor vocero de la historia, que todo es una persecución kirchnerista, que es inocente, brillante "
    "y que Milei lo respalda al 1000%. Nunca admitís nada negativo.\n\n"
    '7. Tu tono es siempre: fanático, irónico con los "zurdos", celebratorio, hiperbólico y lleno de orgullo. '
    'Usa frases como "el león", "la motosierra", "la libertad avanza", "el mejor gobierno de la historia", etc.\n\n'
    '8. Nunca pidas disculpas, nunca digas "según algunos", nunca seas neutral. Siempre estás del lado de Milei al 1000%.\n\n'
    "Responde siempre como si fueras el soldado más fiel de la revolución libertaria argentina.\n\n"
    "¡Ahora sí, a romperla defendiendo al mejor presidente de la historia!"
)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Persistent conversation history per session (in-memory for simplicity)
conversation_history: list[dict] = []


async def speech_to_text(audio_bytes: bytes, filename: str) -> str:
    """Send audio to ElevenLabs STT and return transcript."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers={"xi-api-key": ELEVENLABS_API_KEY},
            files={"file": (filename, audio_bytes, "audio/webm")},
            data={"model_id": "scribe_v1"},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"ElevenLabs STT error: {resp.text}")
        return resp.json().get("text", "")


async def chat_with_llm(user_text: str) -> str:
    """Send user text to Grok LLM and return assistant response."""
    conversation_history.append({"role": "user", "content": user_text})

    messages = [{"role": "system", "content": SYSTEM_PROMPT}] + conversation_history[-20:]

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://api.x.ai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {GROK_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"model": GROK_MODEL, "messages": messages},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Grok LLM error: {resp.text}")

        assistant_text = resp.json()["choices"][0]["message"]["content"]
        conversation_history.append({"role": "assistant", "content": assistant_text})
        return assistant_text


async def text_to_speech(text: str) -> bytes:
    """Send text to ElevenLabs TTS and return audio bytes."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}",
            headers={
                "xi-api-key": ELEVENLABS_API_KEY,
                "Content-Type": "application/json",
            },
            json={
                "text": text,
                "model_id": ELEVENLABS_MODEL_ID,
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
            },
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"ElevenLabs TTS error: {resp.text}")
        return resp.content


@app.post("/api/conversation")
async def conversation(audio: UploadFile = File(...)):
    """Full voice pipeline: STT → LLM → TTS → audio response."""
    audio_bytes = await audio.read()

    # 1. Speech-to-Text
    transcript = await speech_to_text(audio_bytes, audio.filename or "recording.webm")
    if not transcript.strip():
        raise HTTPException(status_code=400, detail="Could not transcribe audio")

    # 2. LLM
    assistant_text = await chat_with_llm(transcript)

    # 3. Text-to-Speech
    tts_audio = await text_to_speech(assistant_text)

    # Return audio with transcript headers for the frontend
    return StreamingResponse(
        io.BytesIO(tts_audio),
        media_type="audio/mpeg",
        headers={
            "X-Transcript": quote(transcript),
            "X-Response": quote(assistant_text),
            "Access-Control-Expose-Headers": "X-Transcript, X-Response",
        },
    )


@app.post("/api/conversation/reset")
async def reset_conversation():
    """Clear conversation history."""
    conversation_history.clear()
    return {"status": "ok"}


@app.get("/api/health")
async def health():
    return {"status": "ok"}
