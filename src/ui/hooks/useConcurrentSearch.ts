import { useEffect, useState } from "react";
import {
  idleSearchState,
  runConcurrentSearch,
  type ConcurrentSearchState,
  type SourceState,
} from "../../search/concurrent";

export type { ConcurrentSearchState, SourceState };

export function useConcurrentSearch(query: string): ConcurrentSearchState {
  const [state, setState] = useState<ConcurrentSearchState>(() => idleSearchState());

  useEffect(() => {
    const ctrl = new AbortController();

    void runConcurrentSearch(query, {
      signal: ctrl.signal,
      onUpdate: setState,
    });

    return () => {
      ctrl.abort();
    };
  }, [query]);

  return state;
}
