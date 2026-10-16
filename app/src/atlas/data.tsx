/* The atlas's own data context. It loads the release through lib/core's loader (the same joins
   and integrity rules as every other reader) but fetches only the tables the atlas reads: the
   core event join, plus the report table that carries the synthetic build's demonstration text.
   Electrodes, atlas labels and the CCEP tables are never requested. */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { loadDb, type Db } from '../lib/core/data'

interface AtlasDbState {
  db: Db | null
  error: string | null
  progress: { done: number; total: number }
}

const Ctx = createContext<AtlasDbState>({ db: null, error: null, progress: { done: 0, total: 0 } })

export function AtlasDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AtlasDbState>({ db: null, error: null, progress: { done: 0, total: 1 } })
  useEffect(() => {
    let alive = true
    loadDb((done, total) => { if (alive) setState((s) => ({ ...s, progress: { done, total } })) }, { optional: ['reports'] })
      .then((db) => { if (alive) setState((s) => ({ db, error: null, progress: { done: s.progress.total, total: s.progress.total } })) })
      .catch((e: unknown) => { if (alive) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) })) })
    return () => { alive = false }
  }, [])
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}

export function useAtlasDb(): AtlasDbState {
  return useContext(Ctx)
}
