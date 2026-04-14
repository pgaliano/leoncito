"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export type VoiceState = "idle" | "recording" | "processing" | "speaking";

const SILENCE_THRESHOLD = 8;   // avg amplitude (0–255) below which = silence
const SILENCE_DURATION = 1500; // ms of continuous silence before auto-stop
const MIN_RECORDING_MS = 500;  // don't auto-stop within the first 500ms

export interface Turn {
  user: string;
  assistant: string;
}

interface RecordButtonProps {
  token: string;
  onStateChange: (state: VoiceState) => void;
  onAudioLevel: (level: number) => void;
  onTurn?: (turn: Turn) => void;
}

export default function RecordButton({ token, onStateChange, onAudioLevel, onTurn }: RecordButtonProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const silenceCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const hasVoiceRef = useRef(false);

  const updateState = useCallback(
    (s: VoiceState) => {
      setState(s);
      onStateChange(s);
    },
    [onStateChange],
  );

  const monitorAudioLevel = useCallback(
    (source: MediaElementAudioSourceNode | MediaStreamAudioSourceNode, ctx: AudioContext) => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        onAudioLevel(sum / data.length);
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    },
    [onAudioLevel],
  );

  const stopMonitoring = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    if (silenceCheckRef.current !== null) {
      clearInterval(silenceCheckRef.current);
      silenceCheckRef.current = null;
    }
    silenceStartRef.current = null;
    onAudioLevel(0);
  }, [onAudioLevel]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      hasVoiceRef.current = false;

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        stopMonitoring();

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size === 0 || !hasVoiceRef.current) {
          updateState("idle");
          return;
        }

        updateState("processing");

        try {
          const form = new FormData();
          form.append("audio", blob, "recording.webm");

          const resp = await fetch("/api/conversation", {
            method: "POST",
            headers: { "x-request-token": token },
            body: form,
          });
          if (!resp.ok) {
            let detail = `API error: ${resp.status}`;
            try {
              const body = await resp.json();
              if (body.detail) detail = body.detail;
            } catch { /* non-JSON response */ }
            throw new Error(detail);
          }

          const audioBlob = await resp.blob();
          const transcript = decodeURIComponent(resp.headers.get("x-transcript") ?? "");
          const assistant  = decodeURIComponent(resp.headers.get("x-response")   ?? "");
          if (transcript || assistant) onTurn?.({ user: transcript, assistant });
          const url = URL.createObjectURL(audioBlob);

          updateState("speaking");

          const audio = new Audio(url);
          audioRef.current = audio;

          // Monitor playback audio level
          const ctx = new AudioContext();
          const source = ctx.createMediaElementSource(audio);
          source.connect(ctx.destination);
          monitorAudioLevel(source, ctx);

          audio.onended = () => {
            stopMonitoring();
            URL.revokeObjectURL(url);
            ctx.close();
            updateState("idle");
            startRecording();
          };

          audio.onerror = () => {
            stopMonitoring();
            URL.revokeObjectURL(url);
            ctx.close();
            updateState("idle");
          };

          await audio.play();
        } catch (err) {
          console.error("Conversation error:", err);
          updateState("idle");
        }
      };

      recorder.start();
      updateState("recording");

      // Monitor mic input level
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      monitorAudioLevel(src, ctx);

      // Silence detection: auto-stop after sustained quiet
      const recordingStart = Date.now();
      silenceStartRef.current = null;
      silenceCheckRef.current = setInterval(() => {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const level = sum / data.length;

        if (Date.now() - recordingStart < MIN_RECORDING_MS) return;

        if (level < SILENCE_THRESHOLD) {
          if (silenceStartRef.current === null) silenceStartRef.current = Date.now();
          else if (Date.now() - silenceStartRef.current >= SILENCE_DURATION) {
            clearInterval(silenceCheckRef.current!);
            silenceCheckRef.current = null;
            recorder.stop();
          }
        } else {
          hasVoiceRef.current = true;
          silenceStartRef.current = null;
        }
      }, 100);
    } catch (err) {
      console.error("Mic access error:", err);
      updateState("idle");
    }
  }, [updateState, monitorAudioLevel, stopMonitoring]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

  const [started, setStarted] = useState(false);
  const [isGreeting, setIsGreeting] = useState(false);

  // Play greeting then kick off the recording loop — must be called from a user gesture
  const startSession = useCallback(async () => {
    setStarted(true);
    setIsGreeting(true);
    try {
      updateState("speaking");
      const resp = await fetch("/api/greeting");
      if (!resp.ok) { setIsGreeting(false); updateState("idle"); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      // AudioContext must be created / resumed inside a user-gesture call stack
      const ctx = new AudioContext();
      await ctx.resume();
      const source = ctx.createMediaElementSource(audio);
      source.connect(ctx.destination);
      monitorAudioLevel(source, ctx);

      audio.onended = () => {
        stopMonitoring();
        URL.revokeObjectURL(url);
        ctx.close();
        setIsGreeting(false);
        startRecording();
      };
      audio.onerror = () => {
        stopMonitoring();
        URL.revokeObjectURL(url);
        ctx.close();
        setIsGreeting(false);
        updateState("idle");
      };
      await audio.play();
    } catch {
      setIsGreeting(false);
      updateState("idle");
    }
  }, [updateState, monitorAudioLevel, stopMonitoring, startRecording]);

  const handleClick = useCallback(() => {
    if (state === "idle") startRecording();
    else if (state === "speaking") {
      audioRef.current?.pause();
      stopMonitoring();
      updateState("idle");
    }
  }, [state, startRecording, stopMonitoring, updateState]);

  const ringClass: Record<VoiceState, string> = {
    idle: "",
    recording: "animate-pulse ring-2 ring-red-500",
    processing: "animate-spin-slow ring-2 ring-purple-400",
    speaking: "ring-2 ring-purple-500 animate-pulse",
  };

  const icon = (s: VoiceState) => {
    if (s === "idle")
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="1" width="6" height="11" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      );
    if (s === "recording")
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          {/* mouth / lips */}
          <path d="M5 10 Q12 17 19 10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
          <path d="M5 10 Q8 13 12 13 Q16 13 19 10" fill="currentColor" opacity="0.6"/>
        </svg>
      );
    if (s === "processing")
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" />
        </svg>
      );
    // speaking — stop square
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <rect x="5" y="5" width="14" height="14" rx="2" />
      </svg>
    );
  };

  return (
    <>
      {/* Fullscreen tap-to-start overlay — required for mobile audio autoplay */}
      {!started && (
        <button
          onClick={startSession}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/40 backdrop-blur-sm text-white"
        >
          <span className="text-5xl">🦁</span>
          <span className="text-xl font-semibold tracking-wide">Tocá para empezar</span>
        </button>
      )}

      <button
        onClick={handleClick}
        disabled={!started || isGreeting || state === "processing" || state === "recording"}
        className={`
          fixed bottom-8 left-1/2 -translate-x-1/2 z-50
          w-16 h-16 rounded-full
          bg-purple-900/60 backdrop-blur-md
          border border-purple-500/30
          text-white
          flex items-center justify-center
          transition-all duration-300
          hover:bg-purple-800/70 hover:scale-110
          disabled:opacity-60 disabled:cursor-not-allowed
          ${ringClass[state]}
        `}
        title={
          state === "idle"       ? "Tap to speak"
          : state === "recording"  ? "Listening…"
          : state === "processing" ? "Processing…"
          : "Stop"
        }
      >
        {icon(state)}
      </button>
    </>
  );
}
