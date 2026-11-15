// The browser's localStorage, or null where it is missing or blocked
// (private mode, embedded pages). Every reader and writer wraps its own
// access in try/catch as well: a store can also throw on each call.
export type Store = Pick<Storage, "getItem" | "setItem">;

export function browserStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
