// In-memory session (ADR-007): the access token is never written to
// localStorage/sessionStorage — after a reload it is restored via the
// httpOnly refresh cookie.

export type SessionState =
  | { status: "loading"; token: null }
  | { status: "authenticated"; token: string }
  | { status: "anonymous"; token: null };

let state: SessionState = { status: "loading", token: null };
const listeners = new Set<() => void>();

function emit(next: SessionState) {
  state = next;
  for (const listener of listeners) listener();
}

export const session = {
  get: (): SessionState => state,
  token: (): string | null => state.token,
  setToken: (token: string) => emit({ status: "authenticated", token }),
  clear: () => emit({ status: "anonymous", token: null }),
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Test helper. */
  reset: () => emit({ status: "loading", token: null }),
};
