import { useMemo, useState } from "react";
import { type LogEntry, api } from "./api";
import { ModeBadge, PageHead, Term, logSentence, logTitle, useAsync } from "./ui";

const FILTERS: Array<[string, string, string[]]> = [
  ["all", "Everything", []],
  ["checks", "Trade checks", ["simulation"]],
  ["proposals", "Proposals", ["proposal"]],
  ["actions", "Actions", ["execution", "execution_blocked", "live_order_sent", "live_iso_margin_sent", "paper_stop_triggered", "execution_error"]],
  ["vault", "Vault", ["vault_decision"]],
];

export function AuditLog() {
  const l = useAsync(() => api.log(300), []);
  const [v, setV] = useState<Awaited<ReturnType<typeof api.verify>> | null>(null);
  const [filter, setFilter] = useState("all");
  const verify = async () => setV(await api.verify());
  const rows = useMemo(() => {
    const types = FILTERS.find(([k]) => k === filter)?.[2] ?? [];
    return (l.data?.entries ?? []).filter((e) => types.length === 0 || types.includes(e.type));
  }, [l.data, filter]);
  return (
    <>
      <PageHead
        title="Audit log"
        what={<>Everything Apex does — each trade check, proposal and action — is written here as a <Term k="signed">signed, chained record</Term>. Nobody, including us, can quietly change history without it showing up.</>}
        tip={<>press <b>Verify</b> to re-check every entry's fingerprint and signature right now.</>}
      />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="verifybar">
          <button className="btn" onClick={verify}>Verify the whole log</button>
          <button className="btn ghost" onClick={l.reload}>Refresh</button>
          {v && (v.ok
            ? <span className="ok-t verify-ok">✓ All {v.entries} entries check out — chain unbroken, every signature valid.</span>
            : <span className="bad-t">✕ Tampering detected at entry #{v.firstBadSeq}: {v.error}</span>)}
        </div>
        <p className="basis" style={{ marginBottom: 0 }}>How it works: each entry stores the fingerprint (hash) of the one before it and is signed with a key kept separate from any trading key. Changing or deleting one entry breaks every entry after it.</p>
      </div>
      <div className="card">
        <div className="filters">
          {FILTERS.map(([k, label]) => <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{label}</button>)}
        </div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>#</th><th>When</th><th>What</th><th>What happened</th><th>Account</th><th>Fingerprint</th></tr></thead>
            <tbody>
              {rows.map((e: LogEntry) => (
                <tr key={e.seq}>
                  <td className="num">{e.seq}</td>
                  <td className="muted">{new Date(e.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                  <td><b>{logTitle(e.type)}</b></td>
                  <td style={{ whiteSpace: "normal", minWidth: 320 }}>{logSentence(e)}</td>
                  <td><ModeBadge mode={e.mode === "live" ? "LIVE" : e.mode === "paper" ? "PAPER" : "SCENARIO"} /></td>
                  <td className="mono muted" title={e.hash}>{e.hash.slice(0, 10)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {l.data && rows.length === 0 && <p className="muted">Nothing here yet.</p>}
      </div>
    </>
  );
}
