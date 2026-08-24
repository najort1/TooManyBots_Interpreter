export type ServerSequenceDecision = "apply" | "drop" | "resync";

export function createRealtimeLifecycleController() {
  let generation = 0;
  let clientSeq = 0;
  let serverSeq = 0;
  let resyncing = false;
  let roomId = "";

  return {
    acceptSession(nextRoomId: string, nextClientSeq = 1) {
      generation += 1; roomId = nextRoomId; clientSeq = Math.max(0, nextClientSeq - 1); serverSeq = 0; resyncing = false; return generation;
    },
    invalidate() { generation += 1; resyncing = true; return generation; },
    isCurrent(value: number) { return value === generation; },
    nextClientSeq() { clientSeq += 1; return clientSeq; },
    acceptServerSeq(value: number): ServerSequenceDecision {
      if (!Number.isSafeInteger(value) || value <= serverSeq || resyncing) return "drop";
      if (serverSeq > 0 && value !== serverSeq + 1) { resyncing = true; return "resync"; }
      serverSeq = value; return "apply";
    },
    snapshot() { return { generation, clientSeq, serverSeq, resyncing, roomId }; },
  };
}
export type RealtimeLifecycleController = ReturnType<typeof createRealtimeLifecycleController>;
