"use client";

import { useEffect } from "react";

/** Keeps the message list scrolled to the newest message when messages arrive. */
export function ScrollToBottom({ targetId, count }: { targetId: string; count: number }) {
  useEffect(() => {
    const el = document.getElementById(targetId);
    if (el) el.scrollTop = el.scrollHeight;
  }, [targetId, count]);
  return null;
}
