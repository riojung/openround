"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

export function PresentationMedia({
  sessionId,
  mediaId,
  altText,
  participant = false,
}: {
  sessionId: string;
  mediaId: string | null;
  altText: string | null;
  participant?: boolean;
}) {
  const [source, setSource] = useState("");

  useEffect(() => {
    if (!mediaId) {
      setSource("");
      return;
    }
    const token = participant
      ? sessionStorage.getItem(`openround:presentation-participant:${sessionId}`)
      : null;
    if (participant && !token) {
      setSource("");
      return;
    }
    let active = true;
    const path = participant
      ? `/v1/presentation-sessions/${sessionId}/media/${mediaId}`
      : `/v1/presentation-sessions/${sessionId}/host-media/${mediaId}`;
    void apiFetch<{ downloadUrl: string }>(path, {
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    })
      .then(({ downloadUrl }) => {
        if (active) setSource(downloadUrl);
      })
      .catch(() => {
        if (active) setSource("");
      });
    return () => {
      active = false;
    };
  }, [mediaId, participant, sessionId]);

  return source ? (
    <img alt={altText ?? ""} className="question-media" height={360} src={source} width={640} />
  ) : null;
}
