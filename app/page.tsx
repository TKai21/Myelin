"use client";

import { useEffect, useState } from "react";
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

  if (authenticated === null) return null;
  if (!authenticated) {
    return <PasswordGate onUnlock={() => setAuthenticated(true)} />;
  }
  return <ResultsPanel />;
}
