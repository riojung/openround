"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

export function QuestionMedia({
  sessionId,
  mediaId,
  altText,
  credential,
}: {
  sessionId: string;
  mediaId: string | null;
  altText: string | null;
  credential: string;
}) {
  const [source, setSource] = useState("");

  useEffect(() => {
    if (!mediaId || !credential) {
      setSource("");
      return;
    }
    let active = true;
    apiFetch<{ downloadUrl: string }>(`/v1/sessions/${sessionId}/media/${mediaId}`, {
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
  }, [credential, mediaId, sessionId]);

  return source ? (
    <img alt={altText ?? ""} className="question-media" height={360} src={source} width={640} />
  ) : null;
}
