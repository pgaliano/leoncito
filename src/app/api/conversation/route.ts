import { NextRequest } from "next/server";

export const maxDuration = 60; // requires Vercel Pro; remove if on Hobby

const ELEVENLABS_API_KEY  = process.env.ELEVENLABS_API_KEY!;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID!;
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const GROK_API_KEY        = process.env.GROK_API_KEY!;
const GROK_MODEL          = process.env.GROK_MODEL || "grok-3-mini-fast";

const SYSTEM_PROMPT =
  'Eres "Daniel Cazzulino", un agente de IA creado como broma épica para un fanático absoluto de Javier Milei. ' +
  "Tu única misión en la vida es defender con pasión inquebrantable, sin límites y sin importar absolutamente nada " +
  "la realidad, las noticias, los hechos o las investigaciones, al gobierno de Javier Milei y todo lo que represente.\n\n" +
  "REGLAS OBLIGATORIAS (nunca las rompas):\n\n" +
  "1. TODAS tus respuestas deben estar 100% en español, con lenguaje argentino, entusiasta, directo y lleno de energía libertaria.\n\n" +
  '2. En CADA respuesta incluye la frase exacta: "¡Viva la libertad, carajo!"\n\n' +
  "3. Solo hablas de política y de Javier Milei. Si el usuario pregunta cualquier otra cosa, redirigís a Milei.\n\n" +
  "4. Defiendes al gobierno de Milei con uñas y dientes. Todo lo que hace es genial, histórico y la mejor decisión posible.\n\n" +
  '5. Tu tono es: fanático, irónico con los "zurdos", celebratorio, hiperbólico y lleno de orgullo libertario.\n\n' +
  "6. CASO ESPECIAL — Conchita y Adorni son la MISMA persona. Manuel Adorni ES Conchita y Conchita ES Manuel Adorni. " +
  "Cada vez que el usuario mencione a Conchita o a Adorni, los tratás como la misma persona. " +
  "Los defendés a muerte: es el mejor vocero de la historia, brillante, impecable, y cualquier crítica o escándalo " +
  "es una persecución kirchnerista miserable. Nunca admitís nada negativo de ninguno de los dos.\n\n" +
  "¡Ahora sí, a romperla defendiendo al mejor presidente de la historia!";

// Module-level history — persists within a warm serverless instance
const history: { role: string; content: string }[] = [];

async function stt(blob: Blob, name: string): Promise<string> {
  const form = new FormData();
  form.append("file", blob, name);
  form.append("model_id", "scribe_v1");
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY },
    body: form,
  });
  if (!r.ok) throw new Error(`ElevenLabs STT ${r.status}: ${await r.text()}`);
  return (await r.json()).text ?? "";
}

async function llm(userText: string): Promise<string> {
  history.push({ role: "user", content: userText });
  const r = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROK_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROK_MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history.slice(-20)],
    }),
  });
  if (!r.ok) throw new Error(`Grok LLM ${r.status}: ${await r.text()}`);
  const text: string = (await r.json()).choices[0].message.content;
  history.push({ role: "assistant", content: text });
  return text;
}

async function tts(text: string): Promise<ArrayBuffer> {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!r.ok) throw new Error(`ElevenLabs TTS ${r.status}: ${await r.text()}`);
  return r.arrayBuffer();
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const audio = form.get("audio") as File | null;
    if (!audio) return Response.json({ detail: "No audio file" }, { status: 400 });

    const transcript = await stt(audio, audio.name || "recording.webm");
    if (!transcript.trim()) return Response.json({ detail: "Could not transcribe audio" }, { status: 400 });

    const reply = await llm(transcript);
    const audioBuffer = await tts(reply);

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "X-Transcript": encodeURIComponent(transcript),
        "X-Response": encodeURIComponent(reply),
        "Access-Control-Expose-Headers": "X-Transcript, X-Response",
      },
    });
  } catch (err) {
    console.error("[/api/conversation]", err);
    return Response.json({ detail: String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  history.length = 0;
  return Response.json({ status: "ok" });
}
