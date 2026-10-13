import { useCallback, useEffect, useRef, useState } from "react";
import type { Glass } from "../core/agf.ts";
import type { ConvertOptions, ConvertResult } from "../core/convert.ts";
import type { WorkerRequest } from "./worker.ts";

export interface Job {
  id: number;
  name: string;
  data: Uint8Array;
  result?: ConvertResult;
  ms?: number;
  busy: boolean;
}

export function useConverter(options: ConvertOptions, catalogs: [string, Glass[]][]) {
  const workerRef = useRef<Worker | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const nextId = useRef(1);
  const generation = useRef(new Map<number, number>());
  const jobsRef = useRef<Job[]>([]);
  jobsRef.current = jobs;

  useEffect(() => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (ev: MessageEvent<{ id: number; gen: number; result: ConvertResult; ms: number }>) => {
      const { id, gen, result, ms } = ev.data;
      if (generation.current.get(id) !== gen) return;
      setJobs((js) => js.map((j) => (j.id === id ? { ...j, result, ms, busy: false } : j)));
    };
    workerRef.current = w;
    return () => w.terminate();
  }, []);

  const post = (msg: WorkerRequest & { gen?: number }) => workerRef.current?.postMessage(msg);

  const run = useCallback(
    (list: Job[]) => {
      for (const j of list) {
        const gen = (generation.current.get(j.id) ?? 0) + 1;
        generation.current.set(j.id, gen);
        post({ type: "convert", id: j.id, name: j.name, data: j.data, options, gen } as WorkerRequest & { gen: number });
      }
    },
    [options],
  );

  useEffect(() => {
    post({ type: "catalogs", catalogs });
    const current = jobsRef.current;
    if (current.length) {
      setJobs((js) => js.map((j) => ({ ...j, busy: true })));
      run(current);
    }
  }, [catalogs, run]);

  const add = useCallback(
    (files: { name: string; data: Uint8Array }[]) => {
      const fresh = files.map((f) => ({ id: nextId.current++, name: f.name, data: f.data, busy: true }));
      setJobs((js) => [...js, ...fresh]);
      run(fresh);
    },
    [run],
  );

  const remove = useCallback((id: number) => setJobs((js) => js.filter((j) => j.id !== id)), []);
  const clear = useCallback(() => setJobs([]), []);

  return { jobs, add, remove, clear };
}
