"use client";

import { useState, useCallback } from "react";
import SphereScene from "@/components/SphereScene";
import RecordButton, { type VoiceState } from "@/components/RecordButton";

export default function HomeClient({ token }: { token: string }) {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);

  const handleStateChange = useCallback((s: VoiceState) => setVoiceState(s), []);
  const handleAudioLevel = useCallback((l: number) => setAudioLevel(l), []);

  return (
    <>
      <SphereScene isSpeaking={voiceState === "speaking"} audioLevel={audioLevel} />
      <RecordButton
        token={token}
        onStateChange={handleStateChange}
        onAudioLevel={handleAudioLevel}
      />
    </>
  );
}
