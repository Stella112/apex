import { useEffect, useState } from "react";
import { AuditLog } from "./AuditLog";
import { Circuit } from "./Circuit";
import { Credit } from "./Credit";
import { Markets } from "./Markets";
import { Overview } from "./Overview";
import { Positions } from "./Positions";
import { Vault } from "./Vault";
import { type Source, type Status, api } from "./api";
import { GlossaryButton, ModeBadge } from "./ui";

type Page = "overview" | "radar" | "circuit" | "positions" | "credit" | "vault" | "log";
const DISCLAIMER = "Numbers are estimates from live Strike data, not guarantees, and not financial advice. Apex's limits are enforced by Strike key permissions and the Apex rule engine, not by an on-chain contract.";

const TABS: Array<[Page, string, string]> = [
  ["overview", "Overview", "What Apex does, proven live"],
  ["radar", "Markets", "Every perp on Strike, live"],
  ["circuit", "Check a trade", "Test a trade before you place it"],
  ["positions", "Weekend risk", "How likely a weekend gap is to liquidate you"],
  ["credit", "Credit", "Borrow-and-Earn credit line health"],
  ["vault", "Vault", "A rule-governed paper vault"],
  ["log", "Audit log", "Signed record of everything Apex does"],
];

function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 29 28H3z" fill="var(--accent)" /><path d="M16 12 22 24H10z" fill="var(--bg)" /></svg>
  );
}

const pageFromHash = (): Page => (TABS.some(([k]) => k === location.hash.slice(1)) ? (location.hash.slice(1) as Page) : "overview");

export function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [status, setStatus] = useState<Status | null>(null);
  const [source, setSource] = useState<Source>("paper");
  useEffect(() => {
    api.status().then((s) => { setStatus(s); setSource(s.defaultSource); }, () => undefined);
  }, []);
  useEffect(() => {
    location.hash = page;
    window.scrollTo({ top: 0 });
  }, [page]);
  useEffect(() => {
    const on = () => setPage(pageFromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return (
    <>
      <header className="top">
        <div className="top-inner">
          <div className="brand"><Logo />APEX <small>risk desk for Strike</small></div>
          <nav aria-label="Pages">{TABS.map(([k, t, tip]) => <button key={k} className={page === k ? "on" : ""} title={tip} onClick={() => setPage(k)}>{t}</button>)}</nav>
          <span className="spacer" />
          <GlossaryButton />
          <ModeBadge mode={status?.mode === "live" ? "LIVE" : "PAPER"} />
        </div>
      </header>
      <main>
        {status?.readOnly && (
          <div className="demo-banner">
            <b>Public read-only demo.</b> Everything is computed live from Strike mainnet. The paper account was opened by the server on live prices (simulated fills, no real orders) and confirming actions is switched off here.{" "}
            <a href="https://github.com/Stella112/apex">Run Apex locally</a> for the full flow: propose → confirm → record.
          </div>
        )}
        {page === "overview" && <Overview status={status} go={(p) => setPage(p as Page)} />}
        {page === "radar" && <Markets />}
        {page === "circuit" && <Circuit source={source} status={status} />}
        {page === "positions" && <Positions source={source} setSource={setSource} status={status} />}
        {page === "credit" && <Credit />}
        {page === "vault" && <Vault readOnly={status?.readOnly === true} />}
        {page === "log" && <AuditLog />}
        <p className="disclaimer">{DISCLAIMER}</p>
      </main>
    </>
  );
}
