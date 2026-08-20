"use client";

import React, { useEffect, useState } from "react";
import { SendHorizontal } from "lucide-react";

export type ChatMessage = {
  id: string;
  senderJid: string;
  nickname: string;
  text: string;
  isNpc?: boolean;
  createdAt: number;
};

type SpeechBubbleLayerProps = {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
};

export default function SpeechBubbleLayer({ messages, onSendMessage }: SpeechBubbleLayerProps) {
  const [inputText, setInputText] = useState("");
  const [activeBubbles, setActiveBubbles] = useState<ChatMessage[]>([]);

  useEffect(() => {
    setActiveBubbles(messages.slice(-5));

    // Desaparece com balões antigos após 7 segundos
    const timer = setTimeout(() => {
      const now = Date.now();
      setActiveBubbles((prev) => prev.filter((msg) => now - msg.createdAt < 7000));
    }, 7000);

    return () => clearTimeout(timer);
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText("");
  };

  return (
    <div className="casas-chat-layer">
      <div className="casas-chat-bubbles" aria-live="polite">
        {activeBubbles.map((msg) => (
          <div
            key={msg.id}
            className={`casas-chat-bubble ${msg.isNpc ? "casas-chat-bubble-npc" : ""}`}
          >
            <div className="casas-chat-author">
              <span>{msg.isNpc ? "🤖" : "💬"}</span>
              <span>{msg.nickname}</span>
            </div>
            <p>{msg.text}</p>
          </div>
        ))}
      </div>

      <div className="casas-chat-composer">
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            maxLength={120}
            placeholder="Fale algo no quarto ou chame o @mordomo..."
          />
          <button
            type="submit"
            aria-label="Enviar mensagem"
          >
            <span>Falar</span><SendHorizontal size={16} strokeWidth={2.5} />
          </button>
        </form>
      </div>
    </div>
  );
}
