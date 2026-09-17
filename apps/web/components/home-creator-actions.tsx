"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

export function HomeCreatorActions() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch("/v1/auth/me")
      .then(() => {
        if (active) setSignedIn(true);
      })
      .catch(() => {
        if (active) setSignedIn(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="hero-actions">
      <Link className="button" href={signedIn === false ? "/signin" : "/dashboard"}>
        {signedIn === true
          ? "Manage my quizzes"
          : signedIn === false
            ? "Create a free quiz"
            : "Create or manage quizzes"}
      </Link>
      <Link className="button-quiet" href="#how-it-works">
        See how it works
      </Link>
    </div>
  );
}
