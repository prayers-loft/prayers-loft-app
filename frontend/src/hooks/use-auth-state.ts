// Tiny React hook over the auth-store singleton.
import { useEffect, useState } from "react";
import { AuthState, getAuthState, subscribeAuth } from "@/src/lib/auth-store";

export function useAuthState(): AuthState {
  const [s, setS] = useState<AuthState>(getAuthState());
  useEffect(() => subscribeAuth(setS), []);
  return s;
}
