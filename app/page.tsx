"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { PasswordGate } from "@/components/PasswordGate";
import { ResultsPanel } from "@/components/ResultsPanel";

export default function Home() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth")
      .then((res) => res.json())
      .then((data) => setAuthenticated(Boolean(data.authenticated)))
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-brand" />
      </div>
    );
  }

  if (!authenticated) {
    return <PasswordGate onUnlock={() => setAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen">
      <Header />
      <ResultsPanel />
    </div>
  );
}
