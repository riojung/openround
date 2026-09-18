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
  const announcement =
    seconds === 10 || seconds === 5
      ? `${seconds} seconds remaining`
      : seconds === 0 && deadline
        ? "Time is up"
        : "";
  return (
    <>
      <span aria-live="off" className="countdown" role="timer">
        {deadline ? `${seconds}s` : "Paused"}
      </span>
      <span aria-atomic="true" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
