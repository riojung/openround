"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

export function QuestionMedia({
  sessionId,
  mediaId,
  altText,
  credential,
  mode = "live",
}: {
  sessionId: string;
  mediaId: string | null;
  altText: string | null;
  credential: string;
  mode?: "live" | "followup";
}) {
  const [source, setSource] = useState("");

  useEffect(() => {
    if (!mediaId || !credential) {
      setSource("");
      return;
    }
    let active = true;
    const path =
      mode === "followup"
        ? `/v1/followups/${sessionId}/media/${mediaId}`
        : `/v1/sessions/${sessionId}/media/${mediaId}`;
    apiFetch<{ downloadUrl: string }>(path, {
      headers: { authorization: `Bearer ${credential}` },
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
  }, [credential, mediaId, mode, sessionId]);

  return source ? (
    <img alt={altText ?? ""} className="question-media" height={360} src={source} width={640} />
  ) : null;
}
