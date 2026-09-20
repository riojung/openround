"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Entitlements,
  WorkspaceProductFeatures as ContractWorkspaceProductFeatures,
} from "@openround/contracts";
import { apiFetch, humanError } from "../../lib/api";

export interface WorkspaceCreator {
  userId: string;
  workspaceId: string;
  email: string;
  segment: "education" | "workplace";
  role: "owner" | "editor" | "viewer";
  plan: "free" | "pro" | "team";
}

export type WorkspaceProductFeatures = ContractWorkspaceProductFeatures;

interface WorkspaceAccountResponse {
  creator: WorkspaceCreator;
  entitlements: Entitlements;
  productFeatures: WorkspaceProductFeatures;
}

interface WorkspaceContextValue {
  creator: WorkspaceCreator | null;
  entitlements: Entitlements | null;
  productFeatures: WorkspaceProductFeatures | null;
  loading: boolean;
  error: string;
  canEdit: boolean;
  refreshAccount: () => Promise<void>;
  signOut: () => Promise<void>;
  startUpgrade: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const [creator, setCreator] = useState<WorkspaceCreator | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [productFeatures, setProductFeatures] = useState<WorkspaceProductFeatures | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshAccount = useCallback(async () => {
    setError("");
    try {
      const account = await apiFetch<WorkspaceAccountResponse>("/v1/auth/me");
      setCreator(account.creator);
      setEntitlements(account.entitlements);
      setProductFeatures(account.productFeatures);
    } catch (caught) {
      if ((caught as { status?: number }).status === 401) {
        router.replace("/signin");
        return;
      }
      setError(humanError(caught));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      creator,
      entitlements,
      productFeatures,
      loading,
      error,
      canEdit: creator?.role === "owner" || creator?.role === "editor",
      refreshAccount,
      signOut: async () => {
        await apiFetch("/v1/auth/logout", { method: "POST", body: "{}" });
        router.replace("/");
      },
      startUpgrade: async () => {
        const result = await apiFetch<{ url: string }>("/v1/billing/checkout", {
          method: "POST",
          body: "{}",
        });
        window.location.assign(result.url);
      },
    }),
    [creator, entitlements, error, loading, productFeatures, refreshAccount, router],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
