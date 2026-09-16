"use client";

import { useEffect, useState } from "react";

export function Countdown({ deadline }: { deadline: string | null }) {
  const [remaining, setRemaining] = useState(() =>
    deadline ? Math.max(0, new Date(deadline).getTime() - Date.now()) : 0,
  );

  useEffect(() => {
    const update = () =>
      setRemaining(deadline ? Math.max(0, new Date(deadline).getTime() - Date.now()) : 0);
    update();
    const interval = window.setInterval(update, 100);
    return () => window.clearInterval(interval);
  }, [deadline]);

  const seconds = Math.ceil(remaining / 1_000);
  return (
    <span className="countdown" role="timer" aria-live={seconds <= 5 ? "assertive" : "off"}>
      {deadline ? `${seconds}s` : "Paused"}
    </span>
  );
}
