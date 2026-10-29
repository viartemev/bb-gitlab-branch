import { useCallback, useEffect, useRef, useState } from "react";

export type Page<T> = {
  items: T[];
  next: number | null;
  stageOrder?: string[];
};
type State<T> = Page<T> & {
  busy: boolean;
  error: string;
  all: boolean;
  pages: number;
};
/** Refresh loaded pages in place; keep accordion/search state in the caller. */
export function usePages<T extends { id: string | number }>(
  load: (page: number) => Promise<Page<T>>,
  refresh: string,
  autoAll = false,
) {
  const initial: State<T> = {
    items: [],
    next: null,
    busy: true,
    error: "",
    all: false,
    pages: 0,
    stageOrder: [],
  };
  const [state, setState] = useState<State<T>>(initial);
  const stateRef = useRef(state),
    generation = useRef(0),
    inFlight = useRef(false),
    stopped = useRef(false);
  const update = useCallback((next: State<T>) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const request = useCallback(
    async (mode: "refresh" | "more" | "all") => {
      if (inFlight.current) return;
      const token = generation.current;
      inFlight.current = true;
      stopped.current = false;
      const alive = () => token === generation.current;
      const previous = stateRef.current;
      update({ ...previous, busy: true, error: "", all: mode === "all" });
      let page = mode === "refresh" ? 1 : previous.next;
      if (page === null) {
        update({ ...stateRef.current, busy: false, all: false });
        inFlight.current = false;
        return;
      }
      const targetPages = Math.max(previous.pages, 1);
      const collected = new Map<string | number, T>(
        mode === "refresh" ? [] : previous.items.map((i) => [i.id, i]),
      );
      let stageOrder =
        mode === "refresh" ? ([] as string[]) : previous.stageOrder;
      try {
        while (page !== null && alive()) {
          const result = await load(page);
          if (!alive()) return;
          if (result.next !== null && result.next <= page)
            throw new Error(
              "GitLab вернул повторную страницу. Обновите панель.",
            );
          for (const item of result.items) collected.set(item.id, item);
          if (result.stageOrder?.length) stageOrder = result.stageOrder;
          // During refresh retain old content until every already loaded page is ready.
          const continuing =
            !stopped.current &&
            result.next !== null &&
            (mode === "all" ||
              (mode === "refresh" && (autoAll || page < targetPages)));
          const current = {
            items: [...collected.values()],
            next: result.next,
            pages: page,
            busy: continuing,
            all: mode === "all",
            error: "",
            stageOrder,
          };
          if (mode !== "refresh" || !continuing || previous.pages === 0)
            update(current);
          if (!continuing) {
            if (mode === "refresh") update(current);
            break;
          }
          page = result.next;
        }
      } catch (e) {
        if (alive())
          update({
            ...stateRef.current,
            busy: false,
            error: e instanceof Error ? e.message : String(e),
          });
      } finally {
        if (alive()) {
          inFlight.current = false;
          update({ ...stateRef.current, busy: false, all: false });
        }
      }
    },
    [load, update, autoAll],
  );
  useEffect(() => {
    generation.current++;
    inFlight.current = false;
    update(initial);
    void request("refresh");
    return () => {
      generation.current++;
      stopped.current = true;
    };
  }, [request]);
  const previousRefresh = useRef(refresh);
  useEffect(() => {
    if (previousRefresh.current !== refresh) {
      previousRefresh.current = refresh;
      void request("refresh");
    }
  }, [refresh, request]);
  return {
    ...state,
    more: () => void request("more"),
    loadAll: () => void request("all"),
    retry: () => void request("refresh"),
    stop: () => {
      stopped.current = true;
    },
  };
}
