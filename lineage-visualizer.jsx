import { useState, useEffect, useMemo, useRef } from "react";

/* ────────────────────────────────────────────────────────────────
   Sample lineage document (conforms to lineage-schema.json)
──────────────────────────────────────────────────────────────── */
const LINEAGE = {
  lineageId: "lin-8f2a",
  objectId: "order-1001",
  objectType: "Order",
  initialState: {
    orderId: "order-1001",
    customer: "Acme Corp",
    amount: 250.0,
    status: "DRAFT",
  },
  steps: [
    {
      stepId: "step-1",
      sequence: 1,
      name: "Order Validation",
      system: "validation-service",
      actor: "system",
      timestamp: "2026-07-10T09:05:00Z",
      description:
        "Rule engine checks required fields, customer standing and order limits.",
      changes: [
        { field: "status", operation: "MODIFY", oldValue: "DRAFT", newValue: "VALIDATED" },
        { field: "validatedBy", operation: "ADD", oldValue: null, newValue: "rule-engine-v2" },
      ],
    },
    {
      stepId: "step-2",
      sequence: 2,
      name: "Pricing Enrichment",
      system: "pricing-service",
      actor: "user:jsmith",
      timestamp: "2026-07-11T14:20:00Z",
      description: "Applies contract pricing and loyalty discounts.",
      changes: [
        { field: "amount", operation: "MODIFY", oldValue: 250.0, newValue: 225.0, reason: "Loyalty discount applied" },
        { field: "discountCode", operation: "ADD", oldValue: null, newValue: "LOYAL10" },
        { field: "currency", operation: "ADD", oldValue: null, newValue: "USD" },
      ],
    },
    {
      stepId: "step-3",
      sequence: 3,
      name: "Compliance Review",
      system: "compliance-service",
      actor: "user:mlee",
      timestamp: "2026-07-12T16:30:00Z",
      description:
        "Manual review flagged the discount as out of policy for this account tier; discount removed and order approved.",
      changes: [
        { field: "discountCode", operation: "SOFT_DELETE", oldValue: "LOYAL10", newValue: null, reason: "Out of policy for account tier" },
        { field: "amount", operation: "MODIFY", oldValue: 225.0, newValue: 250.0, reason: "Discount reverted" },
        { field: "status", operation: "MODIFY", oldValue: "VALIDATED", newValue: "APPROVED" },
      ],
    },
    {
      stepId: "step-4",
      sequence: 4,
      name: "Fulfillment Handoff",
      system: "fulfillment-service",
      actor: "system",
      timestamp: "2026-07-13T08:00:00Z",
      description: "Order dispatched to the warehouse queue.",
      changes: [
        { field: "warehouse", operation: "ADD", oldValue: null, newValue: "EU-CENTRAL-1" },
        { field: "status", operation: "MODIFY", oldValue: "APPROVED", newValue: "IN_FULFILLMENT" },
      ],
    },
  ],
};

/* ── replay engine: reconstruct state after N steps ─────────── */
function replay(doc, upto) {
  const fields = [];
  const idx = {};
  const put = (name, value) => {
    idx[name] = fields.length;
    fields.push({ name, value, deleted: false, changedAt: 0, op: null });
  };
  Object.entries(doc.initialState).forEach(([k, v]) => put(k, v));
  doc.steps.slice(0, upto).forEach((step, si) => {
    step.changes.forEach((c) => {
      if (idx[c.field] === undefined) put(c.field, null);
      const f = fields[idx[c.field]];
      f.changedAt = si + 1;
      f.op = c.operation;
      if (c.operation === "SOFT_DELETE") f.deleted = true;
      else {
        f.value = c.newValue;
        f.deleted = false;
      }
    });
  });
  return fields;
}

function fieldHistory(doc, name) {
  const out = [];
  doc.steps.forEach((s) => {
    s.changes.forEach((c) => {
      if (c.field === name) out.push({ step: s, change: c });
    });
  });
  return out;
}

const fmt = (v) =>
  v === null || v === undefined ? "∅" : typeof v === "number" ? v.toFixed(2).replace(/\.00$/, "") : String(v);

const OP = {
  ADD: { label: "ADD", color: "#34D399" },
  MODIFY: { label: "MOD", color: "#F5B14C" },
  SOFT_DELETE: { label: "DEL", color: "#F47070" },
};

/* ────────────────────────────────────────────────────────────── */
export default function LineageVisualizer() {
  const doc = LINEAGE;
  const N = doc.steps.length;
  const [cursor, setCursor] = useState(0); // steps applied: 0..N
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selStep, setSelStep] = useState(null); // detail panel
  const [selField, setSelField] = useState(null); // field history
  const [reduceMotion, setReduceMotion] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const h = (e) => setReduceMotion(e.matches);
    mq.addEventListener?.("change", h);
    return () => mq.removeEventListener?.("change", h);
  }, []);

  const TRAVEL = reduceMotion ? 0 : 900 / speed;
  const DWELL = 1400 / speed;

  useEffect(() => {
    clearTimeout(timer.current);
    if (!playing) return;
    if (cursor >= N) {
      setPlaying(false);
      return;
    }
    timer.current = setTimeout(() => {
      setCursor((c) => Math.min(c + 1, N));
      setSelStep(cursor); // auto-follow detail
    }, TRAVEL + DWELL);
    return () => clearTimeout(timer.current);
  }, [playing, cursor, N, TRAVEL, DWELL]);

  const state = useMemo(() => replay(doc, cursor), [doc, cursor]);
  const packetPct = (cursor / N) * 100;
  const activeStep = selStep !== null ? doc.steps[selStep] : null;
  const history = selField ? fieldHistory(doc, selField) : null;

  const go = (c) => {
    setPlaying(false);
    setCursor(c);
    setSelStep(c > 0 ? c - 1 : null);
  };

  return (
    <div style={S.page}>
      <style>{CSS}</style>

      {/* header */}
      <header style={S.header}>
        <div>
          <div style={S.eyebrow}>DATA LINEAGE · {doc.lineageId}</div>
          <div style={S.title}>
            {doc.objectType} <span style={{ color: "#7DB0FF" }}>{doc.objectId}</span>
          </div>
        </div>
        <div style={S.controls}>
          <button style={S.btn} onClick={() => go(0)} aria-label="Restart">⏮</button>
          <button style={S.btn} onClick={() => go(Math.max(0, cursor - 1))} aria-label="Step back">‹</button>
          <button
            style={{ ...S.btn, ...S.btnPrimary }}
            onClick={() => {
              if (cursor >= N) go(0);
              setPlaying((p) => !p);
            }}
          >
            {playing ? "Pause" : cursor >= N ? "Replay" : "Play"}
          </button>
          <button style={S.btn} onClick={() => go(Math.min(N, cursor + 1))} aria-label="Step forward">›</button>
          <button style={S.btn} onClick={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 0.5 : 1))}>
            {speed}×
          </button>
        </div>
      </header>

      {/* pipeline */}
      <section style={S.pipeWrap}>
        <div style={S.track}>
          <div style={{ ...S.trackFill, width: `${packetPct}%`, transition: reduceMotion ? "none" : `width ${TRAVEL}ms cubic-bezier(.4,0,.2,1)` }} />
          <div
            className="packet"
            style={{
              ...S.packet,
              left: `${packetPct}%`,
              transition: reduceMotion ? "none" : `left ${TRAVEL}ms cubic-bezier(.4,0,.2,1)`,
            }}
          />
          {/* nodes */}
          {[...Array(N + 1)].map((_, i) => {
            const step = i > 0 ? doc.steps[i - 1] : null;
            const reached = cursor >= i;
            const isSel = selStep === i - 1 && i > 0;
            return (
              <div key={i} style={{ ...S.nodeCol, left: `${(i / N) * 100}%` }}>
                <button
                  className="node"
                  onClick={() => {
                    if (i === 0) go(0);
                    else {
                      setPlaying(false);
                      setCursor(i);
                      setSelStep(i - 1);
                      setSelField(null);
                    }
                  }}
                  style={{
                    ...S.node,
                    background: reached ? "#7DB0FF" : "#1B2740",
                    borderColor: isSel ? "#E7ECF6" : reached ? "#7DB0FF" : "#324566",
                    boxShadow: reached ? "0 0 14px rgba(125,176,255,.55)" : "none",
                  }}
                  aria-label={step ? step.name : "Initial state"}
                />
                <div style={{ ...S.nodeLabel, color: reached ? "#E7ECF6" : "#5C6B87" }}>
                  {step ? step.name : "Initial"}
                </div>
                <div style={S.nodeSub}>
                  {step ? step.system : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* panels */}
      <main style={S.panels}>
        {/* live object state */}
        <section style={S.panel}>
          <div style={S.panelHead}>
            OBJECT STATE
            <span style={S.panelHint}>after step {cursor} / {N} · click a field for its history</span>
          </div>
          <div>
            {state.map((f) => {
              const fresh = f.changedAt === cursor && cursor > 0;
              return (
                <button
                  key={f.name}
                  className="fieldRow"
                  onClick={() => { setSelField(f.name); setSelStep(null); }}
                  style={{
                    ...S.fieldRow,
                    background: fresh ? "rgba(125,176,255,.07)" : "transparent",
                    borderLeft: fresh ? `2px solid ${OP[f.op]?.color || "#7DB0FF"}` : "2px solid transparent",
                  }}
                >
                  <span style={{ ...S.fieldName, opacity: f.deleted ? 0.45 : 1 }}>{f.name}</span>
                  <span
                    style={{
                      ...S.fieldVal,
                      textDecoration: f.deleted ? "line-through" : "none",
                      color: f.deleted ? "#F47070" : fresh ? OP[f.op]?.color : "#E7ECF6",
                    }}
                  >
                    {f.deleted ? fmt(null) + "  (" + "was " + fmt(fieldHistory(doc, f.name).slice(-1)[0]?.change.oldValue) + ")" : fmt(f.value)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* detail / history panel */}
        <section style={S.panel}>
          {history ? (
            <>
              <div style={S.panelHead}>
                FIELD HISTORY · <span style={{ color: "#7DB0FF" }}>{selField}</span>
                <button style={S.closeBtn} onClick={() => setSelField(null)}>✕ close</button>
              </div>
              {history.length === 0 && (
                <div style={S.empty}>No changes recorded — value comes from the initial state.</div>
              )}
              {history.map(({ step, change }, i) => (
                <ChangeRow key={i} change={change} meta={`step ${step.sequence} · ${step.name}`} />
              ))}
            </>
          ) : activeStep ? (
            <>
              <div style={S.panelHead}>
                STEP {activeStep.sequence} · {activeStep.name.toUpperCase()}
              </div>
              <div style={S.metaGrid}>
                <Meta k="system" v={activeStep.system} />
                <Meta k="actor" v={activeStep.actor} />
                <Meta k="time" v={new Date(activeStep.timestamp).toLocaleString()} />
              </div>
              {activeStep.description && <div style={S.desc}>{activeStep.description}</div>}
              <div style={S.subHead}>CHANGES ({activeStep.changes.length})</div>
              {activeStep.changes.map((c, i) => (
                <ChangeRow key={i} change={c} animate />
              ))}
            </>
          ) : (
            <>
              <div style={S.panelHead}>STEP DETAIL</div>
              <div style={S.empty}>
                Press <b>Play</b> to watch the object travel the pipeline, or click any step node to inspect its changes.
              </div>
            </>
          )}
        </section>
      </main>

      <footer style={S.footer}>
        <Legend color="#34D399" label="ADD" />
        <Legend color="#F5B14C" label="MODIFY" />
        <Legend color="#F47070" label="SOFT DELETE" />
        <span style={{ marginLeft: "auto", color: "#5C6B87" }}>
          persisted as one JSON document · state reconstructed by change replay
        </span>
      </footer>
    </div>
  );
}

function ChangeRow({ change, meta, animate }) {
  const op = OP[change.operation];
  return (
    <div className={animate ? "chg" : ""} style={S.chgRow}>
      <span style={{ ...S.opTag, color: op.color, borderColor: op.color }}>{op.label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.chgField}>
          {change.field}
          {meta && <span style={S.chgMeta}> · {meta}</span>}
        </div>
        <div style={S.chgVals}>
          <span style={{ color: "#8494AE", textDecoration: change.operation !== "ADD" ? "line-through" : "none" }}>
            {fmt(change.oldValue)}
          </span>
          <span style={{ color: "#5C6B87" }}> → </span>
          <span style={{ color: op.color }}>{fmt(change.newValue)}</span>
        </div>
        {change.reason && <div style={S.reason}>“{change.reason}”</div>}
      </div>
    </div>
  );
}

const Meta = ({ k, v }) => (
  <div>
    <div style={{ fontSize: 10, letterSpacing: 1.5, color: "#5C6B87" }}>{k.toUpperCase()}</div>
    <div style={{ fontSize: 12, color: "#C7D2E4" }}>{v || "—"}</div>
  </div>
);

const Legend = ({ color, label }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
    <span style={{ width: 8, height: 8, background: color, borderRadius: 2 }} />
    <span style={{ color: "#8494AE" }}>{label}</span>
  </span>
);

/* ── styles ─────────────────────────────────────────────────── */
const MONO = "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace";
const S = {
  page: {
    minHeight: "100vh",
    background: "radial-gradient(1200px 500px at 50% -10%, #14203A 0%, #0C1220 55%)",
    color: "#E7ECF6",
    fontFamily: MONO,
    padding: "28px clamp(16px, 4vw, 48px)",
    boxSizing: "border-box",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 },
  eyebrow: { fontSize: 10, letterSpacing: 3, color: "#7DB0FF" },
  title: { fontSize: 26, fontWeight: 700, letterSpacing: 0.5, marginTop: 6 },
  controls: { display: "flex", gap: 8 },
  btn: {
    fontFamily: MONO, fontSize: 12, color: "#C7D2E4", background: "#141C2F",
    border: "1px solid #26334E", borderRadius: 6, padding: "8px 12px", cursor: "pointer",
  },
  btnPrimary: { background: "#7DB0FF", color: "#0C1220", fontWeight: 700, border: "1px solid #7DB0FF", minWidth: 74 },

  pipeWrap: { margin: "56px 0 40px", padding: "0 40px" },
  track: { position: "relative", height: 2, background: "#26334E", margin: "0 auto", maxWidth: 980 },
  trackFill: { position: "absolute", top: 0, left: 0, height: 2, background: "#7DB0FF" },
  packet: {
    position: "absolute", top: "50%", width: 14, height: 14,
    transform: "translate(-50%,-50%) rotate(45deg)",
    background: "#7DB0FF", boxShadow: "0 0 18px rgba(125,176,255,.9)", zIndex: 2,
  },
  nodeCol: { position: "absolute", top: "50%", transform: "translate(-50%,-50%)", textAlign: "center", width: 140 },
  node: {
    width: 16, height: 16, borderRadius: "50%", border: "2px solid",
    cursor: "pointer", display: "inline-block", padding: 0,
    transition: "background .3s, box-shadow .3s, border-color .2s",
  },
  nodeLabel: { fontSize: 11, marginTop: 12, letterSpacing: 0.3, lineHeight: 1.3 },
  nodeSub: { fontSize: 9, color: "#5C6B87", marginTop: 3 },

  panels: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, maxWidth: 1080, margin: "0 auto" },
  panel: { background: "#111A2C", border: "1px solid #26334E", borderRadius: 10, padding: "16px 18px", minHeight: 280 },
  panelHead: {
    fontSize: 11, letterSpacing: 2, color: "#7DB0FF", paddingBottom: 10,
    borderBottom: "1px solid #26334E", marginBottom: 10, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap",
  },
  panelHint: { fontSize: 10, letterSpacing: 0.5, color: "#5C6B87", fontWeight: 400 },
  closeBtn: { marginLeft: "auto", background: "none", border: "none", color: "#8494AE", cursor: "pointer", fontFamily: MONO, fontSize: 11 },

  fieldRow: {
    display: "flex", justifyContent: "space-between", gap: 12, width: "100%",
    padding: "8px 10px", background: "none", border: "none", borderRadius: 6,
    fontFamily: MONO, fontSize: 13, cursor: "pointer", textAlign: "left",
  },
  fieldName: { color: "#8494AE" },
  fieldVal: { fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },

  metaGrid: { display: "flex", gap: 24, flexWrap: "wrap", margin: "6px 0 12px" },
  desc: { fontSize: 12, color: "#A8B6CC", lineHeight: 1.6, marginBottom: 14 },
  subHead: { fontSize: 10, letterSpacing: 2, color: "#5C6B87", margin: "10px 0 8px" },

  chgRow: { display: "flex", gap: 10, padding: "9px 6px", borderBottom: "1px solid #1B2740", alignItems: "flex-start" },
  opTag: { fontSize: 9, letterSpacing: 1, border: "1px solid", borderRadius: 4, padding: "2px 6px", marginTop: 2, flexShrink: 0 },
  chgField: { fontSize: 13, color: "#E7ECF6", fontWeight: 600 },
  chgMeta: { fontSize: 10, color: "#5C6B87", fontWeight: 400 },
  chgVals: { fontSize: 12, marginTop: 3 },
  reason: { fontSize: 11, color: "#8494AE", fontStyle: "italic", marginTop: 4 },

  empty: { fontSize: 12, color: "#8494AE", lineHeight: 1.7, padding: "12px 4px" },
  footer: {
    display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap",
    maxWidth: 1080, margin: "22px auto 0", fontSize: 10, letterSpacing: 1,
  },
};

const CSS = `
  .node:focus-visible { outline: 2px solid #E7ECF6; outline-offset: 3px; }
  .fieldRow:hover { background: rgba(125,176,255,.06) !important; }
  .fieldRow:focus-visible { outline: 1px solid #7DB0FF; }
  @keyframes chgIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .chg { animation: chgIn .45s ease both; }
  .chg:nth-child(odd) { animation-delay: .1s; }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 18px rgba(125,176,255,.9);} 50% { box-shadow: 0 0 6px rgba(125,176,255,.4);} }
  .packet { animation: pulse 1.6s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) {
    .chg { animation: none; }
    .packet { animation: none; }
  }
`;
