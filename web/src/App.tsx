import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Config, Milestone, Project, Role, State, Verdict, faceValue, getConfig, getState, inspect, near, post, shortAcct } from './api';
import { Step, fetchBundle, photosOf, verifyInBrowser } from './verify';

const ROLE_LABEL: Record<Role, string> = { client: 'Homeowner', contractor: 'Contractor', investor: 'Investor' };
const STATUS_LABEL: Record<string, string> = { Open: 'Waiting for proof', Verified: 'Approved, in review window', Disputed: 'Contested', Paid: 'Paid', Refunded: 'Refunded' };
const VERDICT_LABEL: Record<string, string> = { APPROVED: 'Approved', REJECTED: 'Rejected', NEEDS_MORE_EVIDENCE: 'More proof', DEFECT_CONFIRMED: 'Defect', NO_DEFECT: 'No defect' };

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [role, setRole] = useState<Role>('contractor');
  const [pid, setPid] = useState<string>('');
  const [mid, setMid] = useState<string>('');
  const [busy, setBusy] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    const [c, s] = await Promise.all([getConfig(), getState()]);
    setConfig(c); setState(s);
    return s;
  }, []);

  useEffect(() => {
    refresh().then((s) => {
      const p = [...s.projects].reverse().find((x) => x.milestones.some((m) => m.verdicts.length)) || s.projects[0];
      if (p) { setPid(p.id); setMid((p.milestones.find((m) => m.status !== 'Open') || p.milestones[0]).id); }
    }).catch((e) => setError(String(e.message || e)));
  }, [refresh]);

  const project = state?.projects.find((p) => p.id === pid);
  const milestone = project?.milestones.find((m) => m.id === mid);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label); setError('');
    try { await fn(); await refresh(); } catch (e: any) { setError(e.message || String(e)); } finally { setBusy(''); }
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden>▚</span>
          <span className="name">Veridom Pay</span>
          <span className="net">NEAR testnet</span>
        </div>
        <nav className="roles" aria-label="Act as">
          {(['client', 'contractor', 'investor'] as Role[]).map((r) => (
            <button key={r} className={r === role ? 'role on' : 'role'} onClick={() => setRole(r)} aria-pressed={r === role}>
              <span>{ROLE_LABEL[r]}</span>
              <small>{config ? `${shortAcct(config.roles[r]?.account_id)} · ${near(config.roles[r]?.balance || '0', 2)} Ⓝ` : '…'}</small>
            </button>
          ))}
        </nav>
      </header>

      <section className="lede">
        <h1>Construction milestones, paid on proof.</h1>
        <p>
          Site photos go to a private AI inspector running inside an attested enclave on NEAR AI Cloud. It signs its verdict there.
          The NEAR contract checks that signature itself before it releases a cent, and turns an approved milestone into a receivable
          the contractor can sell for cash today.
        </p>
      </section>

      {error && <div className="error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}

      <main className="desk">
        <aside className="ledger">
          <div className="ledger-head">
            <label htmlFor="proj">Project</label>
            <select id="proj" value={pid} onChange={(e) => { setPid(e.target.value); const p = state?.projects.find((x) => x.id === e.target.value); setMid(p?.milestones[0].id || ''); }}>
              {state?.projects.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
            </select>
            {role === 'client' && <button className="ghost" onClick={() => setCreating(true)}>New project</button>}
          </div>
          {project && (
            <ol className="milestones">
              {project.milestones.map((m, i) => (
                <li key={m.id}>
                  <button className={m.id === mid ? 'ms on' : 'ms'} onClick={() => setMid(m.id)}>
                    <span className="ms-n">{i + 1}</span>
                    <span className="ms-body">
                      <span className="ms-title">{m.title}</span>
                      <span className={`ms-status s-${m.status}`}>{STATUS_LABEL[m.status]}</span>
                    </span>
                    <span className="ms-amt">{near(m.amount, 2)} Ⓝ</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {project && <ProjectFacts project={project} />}
        </aside>

        {project && milestone && config && state ? (
          <Sheet key={`${pid}:${mid}`} project={project} m={milestone} state={state} config={config} role={role} busy={busy} run={run} />
        ) : (
          <div className="sheet empty">{error ? 'The demo server is not reachable.' : 'Loading the contract state…'}</div>
        )}
      </main>

      {creating && <NewProject onClose={() => setCreating(false)} onCreate={(body) => run('Creating project', async () => { await post('projects', body); setPid(body.id); setMid('M1'); setCreating(false); })} busy={busy} />}

      <footer className="foot">
        Contract <a href={`${config?.explorer}/address/${config?.contract}`} target="_blank" rel="noreferrer">{config?.contract}</a>
        {' '}· inspector {config?.ai.model} · {config?.ai.privacy}
      </footer>
    </div>
  );
}

function ProjectFacts({ project }: { project: Project }) {
  const total = project.milestones.reduce((s, m) => s + BigInt(m.amount), 0n);
  return (
    <dl className="facts">
      <div><dt>In escrow at start</dt><dd>{near(total, 2)} Ⓝ</dd></div>
      <div><dt>Retainage</dt><dd>{project.retainage_bps / 100}% until warranty ends</dd></div>
      <div><dt>Held now</dt><dd>{near(project.retainage_held, 3)} Ⓝ</dd></div>
      <div><dt>Review window</dt><dd>{Math.round(project.review_period_ns / 6e10)} min (demo)</dd></div>
    </dl>
  );
}

function Sheet({ project, m, state, config, role, busy, run }: { project: Project; m: Milestone; state: State; config: Config; role: Role; busy: string; run: (l: string, f: () => Promise<unknown>) => void }) {
  const face = faceValue(m, project);
  const holder = m.token_id ? state.owners[m.token_id] : undefined;
  const listing = m.token_id ? state.listings[m.token_id] : undefined;
  const dueMs = m.approved_at ? Number(BigInt(m.approved_at) / 1_000_000n) + project.review_period_ns / 1e6 : 0;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const windowLeft = Math.max(0, dueMs - now);
  const verdicts = [...m.verdicts].reverse();

  return (
    <article className="sheet">
      <header className="sheet-head">
        <div>
          <p className="crumb">{project.id} / milestone {m.id}</p>
          <h2>{m.title}</h2>
        </div>
        <div className="amount"><strong>{near(m.amount, 2)} Ⓝ</strong><span>held in escrow by the contract</span></div>
      </header>

      <blockquote className="criteria"><span>Acceptance criteria</span>{m.criteria}</blockquote>

      <MoneyTrail m={m} project={project} face={face} holder={holder} listing={listing} windowLeft={windowLeft} />

      <Actions project={project} m={m} role={role} config={config} face={face} holder={holder} listing={listing} windowLeft={windowLeft} busy={busy} run={run} />

      <section className="verdicts">
        <h3>Inspections</h3>
        {verdicts.length === 0 && <p className="quiet">No photos submitted yet. The contractor uploads site photos; the enclave decides.</p>}
        {verdicts.map((v, i) => <VerdictCard key={v.response_hash} v={v} latest={i === 0} />)}
      </section>
    </article>
  );
}

function MoneyTrail({ m, project, face, holder, listing, windowLeft }: { m: Milestone; project: Project; face: bigint; holder?: string; listing?: any; windowLeft: number }) {
  const stage = { Open: 0, Verified: 1, Disputed: 1, Paid: 3, Refunded: 3 }[m.status] + (listing ? 1 : 0) + (holder && holder !== project.contractor && m.status === 'Verified' ? 1 : 0);
  const steps = [
    { t: 'Escrow', d: `${near(m.amount, 2)} Ⓝ locked by ${shortAcct(project.client)}` },
    { t: 'Receivable', d: m.token_id ? `NFT ${m.token_id} worth ${near(face, 3)} Ⓝ, held by ${shortAcct(holder)}` : `Minted when the enclave approves` },
    { t: 'Early cash', d: listing ? `Offered at ${near(listing.price, 4)} Ⓝ` : holder && holder !== project.contractor ? `Sold to ${shortAcct(holder)}` : 'Contractor may sell it at a discount' },
    { t: m.status === 'Refunded' ? 'Refunded' : 'Paid out', d: m.status === 'Paid' ? `${near(face, 3)} Ⓝ to the receivable holder` : m.status === 'Verified' && windowLeft > 0 ? `Pays out in ${fmtLeft(windowLeft)} unless contested` : m.status === 'Verified' ? 'Ready to collect' : m.status === 'Disputed' ? 'Waiting for arbitration' : '—' },
  ];
  return (
    <ol className="trail" aria-label="Where the money is">
      {steps.map((s, i) => (
        <li key={s.t} className={i <= Math.min(stage, 3) ? 'done' : ''}>
          <span className="dot" aria-hidden />
          <strong>{s.t}</strong>
          <span>{s.d}</span>
        </li>
      ))}
    </ol>
  );
}

function Actions({ project, m, role, config, face, holder, listing, windowLeft, busy, run }: any) {
  const files = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const me = config.roles[role]?.account_id;
  const price = (face * 97n) / 100n;
  const can = {
    upload: role === 'contractor' && m.status === 'Open',
    contest: role === 'client' && m.status === 'Verified' && windowLeft > 0,
    sell: m.status === 'Verified' && holder === me && !listing,
    buy: role === 'investor' && listing && holder !== me,
    payNow: role === 'client' && m.status === 'Verified',
    collect: m.status === 'Verified' && windowLeft === 0 && role !== 'client',
  };
  const any = Object.values(can).some(Boolean);
  const kind = 'MILESTONE';
  return (
    <section className="actions" aria-live="polite">
      {busy && <p className="busy"><span className="spinner" aria-hidden />{busy}…</p>}
      {!busy && !any && <p className="quiet">Nothing to do here as {ROLE_LABEL[role as Role].toLowerCase()}. Switch role above to follow the money.</p>}
      {!busy && (can.upload || can.contest) && (
        <div className="upload">
          <input ref={files} type="file" accept="image/*" multiple hidden onChange={(e) => setPicked([...(e.target.files || [])].slice(0, 6))} />
          <button className="ghost" onClick={() => files.current?.click()}>{picked.length ? `${picked.length} photo${picked.length > 1 ? 's' : ''} chosen` : 'Choose site photos'}</button>
          <button className="primary" disabled={!picked.length || !config.ai.canInspect}
            onClick={() => run(can.upload ? 'The enclave is inspecting the photos' : 'Checking your counter-evidence', () => inspect(project.id, m.id, role, picked, kind).then(() => setPicked([])))}>
            {can.upload ? 'Send for inspection' : 'Contest with these photos'}
          </button>
          {!config.ai.canInspect && <small>This server has no NEAR AI key, so new inspections are off. Every verdict below can still be checked.</small>}
        </div>
      )}
      {!busy && can.sell && <button className="primary" onClick={() => run('Listing the receivable', () => post('list', { token_id: m.token_id, price: price.toString() }))}>Sell receivable now for {near(price, 4)} Ⓝ (97%)</button>}
      {!busy && can.buy && <button className="primary" onClick={() => run('Buying the receivable', () => post('buy', { token_id: m.token_id }))}>Buy for {near(listing.price, 4)} Ⓝ, collect {near(face, 4)} Ⓝ</button>}
      {!busy && can.payNow && <button className="ghost" onClick={() => run('Paying the receivable holder', () => post('settle', { project: project.id, milestone: m.id, role: 'client' }))}>Accept and pay now</button>}
      {!busy && can.collect && <button className="primary" onClick={() => run('Collecting payment from escrow', () => post('settle', { project: project.id, milestone: m.id, role }))}>Collect payment</button>}
    </section>
  );
}

function VerdictCard({ v, latest }: { v: Verdict; latest: boolean }) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { fetchBundle(v.response_hash).then((b) => setPhotos(photosOf(b))).catch(() => setMissing(true)); }, [v.response_hash]);
  const check = async () => setSteps(await verifyInBrowser(await fetchBundle(v.response_hash), v));
  const allOk = steps?.every((s) => s.ok);
  return (
    <div className={latest ? 'verdict latest' : 'verdict'}>
      <div className="evidence">
        <div className="photos">
          {photos.map((src, i) => <img key={i} src={src} alt={`Site photo ${i + 1} as signed by the enclave`} />)}
          {missing && <div className="nophoto">Photos are kept by the submitter; hashes below are on-chain.</div>}
        </div>
        <Stamp verdict={v.verdict} seal={v.response_hash} />
      </div>
      <div className="findings">
        <p className="when">{new Date(Number(BigInt(v.at) / 1_000_000n)).toLocaleString()} · {v.model}</p>
        <ul>{v.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>
        {!missing && (
          <div className="proof">
            {!steps && <button className="link" onClick={check}>Check this verdict in your browser</button>}
            {steps && (
              <>
                <p className={allOk ? 'proof-head ok' : 'proof-head bad'}>{allOk ? 'Verified here, without trusting this server.' : 'Verification failed.'}</p>
                <ul className="steps">{steps.map((s) => <li key={s.label} className={s.ok ? 'ok' : 'bad'}><span>{s.ok ? '✓' : '✗'}</span><div>{s.label}<code>{s.detail}</code></div></li>)}</ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stamp({ verdict, seal }: { verdict: string; seal: string }) {
  const tone = verdict === 'APPROVED' || verdict === 'NO_DEFECT' ? 'ok' : verdict === 'NEEDS_MORE_EVIDENCE' ? 'warn' : 'bad';
  const id = useMemo(() => `seal-${seal.slice(0, 8)}`, [seal]);
  const ring = `ENCLAVE-SIGNED · ${seal.slice(0, 24)} · ${seal.slice(24, 48)} · `;
  return (
    <svg className={`stamp ${tone}`} viewBox="0 0 200 200" role="img" aria-label={`Verdict: ${VERDICT_LABEL[verdict] || verdict}`}>
      <defs><path id={id} d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0" /></defs>
      <circle cx="100" cy="100" r="94" className="ring" />
      <circle cx="100" cy="100" r="64" className="ring thin" />
      <text className="seal"><textPath href={`#${id}`}>{ring}</textPath></text>
      <text x="100" y="108" textAnchor="middle" className="word">{(VERDICT_LABEL[verdict] || verdict).toUpperCase()}</text>
    </svg>
  );
}

function NewProject({ onClose, onCreate, busy }: { onClose: () => void; onCreate: (b: any) => void; busy: string }) {
  const [id, setId] = useState(`HOME-${Math.floor(100 + Math.random() * 900)}`);
  const [rows, setRows] = useState([
    { title: 'Floor tiling', criteria: 'The floor is fully covered with tiles and the joints between tiles are grouted. No bare screed, no missing tiles and no leveling clips remain.', amount_near: '0.5' },
  ]);
  const set = (i: number, k: string, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="modal" role="dialog" aria-modal aria-labelledby="np-title">
      <form className="modal-card" onSubmit={(e) => { e.preventDefault(); onCreate({ id, title_milestones: rows }); }}>
        <h2 id="np-title">New project</h2>
        <p className="quiet">You fund every milestone into the contract now. The enclave judges each one against the criteria you write here.</p>
        <label>Project id<input value={id} onChange={(e) => setId(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} required /></label>
        {rows.map((r, i) => (
          <fieldset key={i}>
            <legend>Milestone {i + 1}</legend>
            <label>Title<input value={r.title} onChange={(e) => set(i, 'title', e.target.value)} required /></label>
            <label>Acceptance criteria<textarea rows={3} value={r.criteria} onChange={(e) => set(i, 'criteria', e.target.value)} required /></label>
            <label>Amount (Ⓝ)<input type="number" step="0.01" min="0.01" value={r.amount_near} onChange={(e) => set(i, 'amount_near', e.target.value)} required /></label>
          </fieldset>
        ))}
        <div className="row">
          <button type="button" className="ghost" onClick={() => setRows([...rows, { title: '', criteria: '', amount_near: '0.5' }])}>Add milestone</button>
          <span className="grow" />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!!busy}>{busy || 'Fund and create'}</button>
        </div>
      </form>
    </div>
  );
}

function fmtLeft(ms: number) {
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}
