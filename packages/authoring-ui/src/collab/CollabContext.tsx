/**
 * React context for the optional collaboration session (task 1345 P2).
 *
 * Holds the live `CollabSession | null` and the start/join/leave actions. It is
 * the single place the editor tree reaches the session, mirroring how
 * `StoreProvider` is the single place it reaches the stores. Default state is
 * `null` (solo) — nothing constructs a provider, opens a connection, or creates
 * awareness until the user explicitly starts or joins.
 *
 * Presence rendering reads remote peers via `usePeers()`, which subscribes to
 * the session's awareness controller and re-renders on every peer change (and on
 * TTL-driven drops). When there is no session, `usePeers()` returns `[]` and the
 * subscription is a no-op — zero overhead solo.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CollabSession, StartCollabOptions } from "./collabSession.js";
import { joinCollab, startCollab } from "./collabSession.js";
import type { CollabLink } from "./collabLink.js";
import { type CollabUser, getLocalUser } from "./localUser.js";
import type { PeerPresence } from "./awarenessState.js";
import { useStores } from "../store/StoreProvider.js";

export interface CollabContextValue {
  /** The live session, or null when solo. */
  session: CollabSession | null;
  /** True while a join is in flight. */
  joining: boolean;
  /** The local user identity (stable across sessions). */
  localUser: CollabUser;
  /** Start hosting: mint a room, seed the doc, return the live session. */
  start(options?: Omit<StartCollabOptions, "uiStore" | "user">): CollabSession;
  /** Join an existing session from a parsed link. */
  join(link: CollabLink, options?: Omit<StartCollabOptions, "uiStore" | "user" | "link">): Promise<CollabSession>;
  /** Leave the current session (tears down provider + presence). */
  leave(): void;
}

const CollabContext = createContext<CollabContextValue | null>(null);

/**
 * Provides the collaboration session to the tree. Wires start/join to the
 * document + UI stores from `StoreProvider`. Must sit inside a `StoreProvider`.
 */
export function CollabProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { documentStore, uiStore } = useStores();
  const [session, setSession] = useState<CollabSession | null>(null);
  const [joining, setJoining] = useState(false);
  const localUserRef = useRef<CollabUser | null>(null);
  if (!localUserRef.current) localUserRef.current = getLocalUser();
  const localUser = localUserRef.current;

  const start = useCallback<CollabContextValue["start"]>(
    (options) => {
      // Tearing an existing session down first keeps one provider at a time.
      setSession((prev) => {
        prev?.stop();
        return null;
      });
      const s = startCollab(documentStore, { ...options, uiStore, user: localUser });
      setSession(s);
      return s;
    },
    [documentStore, uiStore, localUser],
  );

  const join = useCallback<CollabContextValue["join"]>(
    async (link, options) => {
      setJoining(true);
      try {
        setSession((prev) => {
          prev?.stop();
          return null;
        });
        const s = await joinCollab(documentStore, link, { ...options, uiStore, user: localUser });
        setSession(s);
        return s;
      } finally {
        setJoining(false);
      }
    },
    [documentStore, uiStore, localUser],
  );

  const leave = useCallback(() => {
    setSession((prev) => {
      prev?.stop();
      return null;
    });
  }, []);

  // Tear the session down if the provider unmounts (page close / Shell unmount).
  // Track the latest session in a ref so the unmount cleanup never tears down a
  // stale one (and does not fire on every session swap).
  const sessionRef = useRef<CollabSession | null>(null);
  sessionRef.current = session;
  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
    };
  }, []);

  const value = useMemo<CollabContextValue>(
    () => ({ session, joining, localUser, start, join, leave }),
    [session, joining, localUser, start, join, leave],
  );

  return <CollabContext.Provider value={value}>{children}</CollabContext.Provider>;
}

/** Access the collaboration context. Returns null-session defaults when absent. */
export function useCollab(): CollabContextValue {
  const ctx = useContext(CollabContext);
  if (ctx) return ctx;
  // Tolerate a missing provider (tests / embeds) by returning an inert value so
  // presence components never throw in a solo embed.
  return INERT;
}

const INERT: CollabContextValue = {
  session: null,
  joining: false,
  localUser: { id: "local", name: "You", color: "#4363d8" },
  start: () => {
    throw new Error("CollabProvider is not mounted");
  },
  join: async () => {
    throw new Error("CollabProvider is not mounted");
  },
  leave: () => {},
};

/**
 * Subscribe to the remote peers of the current session. Re-renders on every
 * awareness change (joins, cursor/selection moves, and TTL-driven drops). Solo:
 * returns `[]` and never subscribes.
 */
export function usePeers(): PeerPresence[] {
  const { session } = useCollab();
  const controller = session?.awarenessController;
  const [peers, setPeers] = useState<PeerPresence[]>(() => controller?.getPeers() ?? []);

  useEffect(() => {
    if (!controller) {
      setPeers([]);
      return;
    }
    setPeers(controller.getPeers());
    return controller.onPeersChange(setPeers);
  }, [controller]);

  return peers;
}
