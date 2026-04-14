"use client";

import { useEffect, useRef } from "react";
import type { Turn } from "./RecordButton";

interface ConversationLogProps {
  turns: Turn[];
}

export default function ConversationLog({ turns }: ConversationLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  if (turns.length === 0) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-40">
      <div
        className="
          pointer-events-auto
          w-full max-w-xl mx-4
          max-h-[60vh] overflow-y-auto
          flex flex-col gap-4
          px-2
          [mask-image:linear-gradient(to_bottom,transparent_0%,black_12%,black_88%,transparent_100%)]
        "
      >
        {turns.map((t, i) => (
          <div key={i} className="flex flex-col gap-2">
            {/* User bubble */}
            <div className="flex justify-end">
              <p className="
                bg-purple-900/50 backdrop-blur-sm
                border border-purple-500/30
                text-white/90 text-sm
                rounded-2xl rounded-tr-sm
                px-4 py-2 max-w-[85%]
                leading-relaxed
              ">
                {t.user}
              </p>
            </div>
            {/* Assistant bubble */}
            <div className="flex justify-start">
              <p className="
                bg-white/10 backdrop-blur-sm
                border border-white/15
                text-white text-sm
                rounded-2xl rounded-tl-sm
                px-4 py-2 max-w-[85%]
                leading-relaxed
              ">
                {t.assistant}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
