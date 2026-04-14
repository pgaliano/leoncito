const ELEVENLABS_API_KEY  = process.env.ELEVENLABS_API_KEY!;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID!;
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

const GREETING = "Hola, soy kazu, el leoncito. Preguntame lo que quieras.";

export async function GET() {
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: GREETING,
        model_id: ELEVENLABS_MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!r.ok) throw new Error(`ElevenLabs TTS ${r.status}: ${await r.text()}`);
    const audio = await r.arrayBuffer();
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg" } });
  } catch (err) {
    console.error("[/api/greeting]", err);
    return Response.json({ detail: String(err) }, { status: 500 });
  }
}
