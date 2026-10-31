export type Role = 'client' | 'contractor' | 'investor';
export type Status = 'Open' | 'Verified' | 'Disputed' | 'Paid' | 'Refunded';
export interface Verdict { verdict: string; findings: string[]; model: string; signer: string; request_hash: string; response_hash: string; at: number }
export interface Milestone { id: string; title: string; criteria: string; amount: string; status: Status; approved_at: number | null; token_id: string | null; verdicts: Verdict[] }
export interface Project { id: string; client: string; contractor: string; retainage_bps: number; review_period_ns: number; warranty_ns: number; milestones: Milestone[]; retainage_held: string; completed_at: number | null; defect_proven: boolean; retainage_settled: boolean }
export interface Listing { seller: string; price: string; face_value: string; due_at: number }
export interface Config { contract: string; explorer: string; roles: Record<Role, { account_id: string; balance: string }>; ai: { model: string; privacy: string; canInspect: boolean } }
export interface State { projects: Project[]; listings: Record<string, Listing>; owners: Record<string, string> }

async function j<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `request failed (${r.status})`);
  return body as T;
}
export const getConfig = () => fetch('/api/config').then((r) => j<Config>(r));
export const getState = () => fetch('/api/projects').then((r) => j<State>(r));
export const post = (path: string, body: unknown) => fetch(`/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => j<any>(r));
export function inspect(project: string, milestone: string, role: Role, files: File[], kind = 'MILESTONE') {
  const fd = new FormData();
  fd.set('project', project); fd.set('milestone', milestone); fd.set('role', role); fd.set('kind', kind);
  files.forEach((f) => fd.append('photos', f));
  return fetch('/api/inspect', { method: 'POST', body: fd }).then((r) => j<{ verdict: Verdict; bundle: string }>(r));
}

export const YOCTO = 10n ** 24n;
export function near(yocto: string | bigint, digits = 4) {
  const v = typeof yocto === 'bigint' ? yocto : BigInt(yocto);
  const whole = v / YOCTO;
  const frac = (v % YOCTO).toString().padStart(24, '0').slice(0, digits).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}
export const faceValue = (m: Milestone, p: Project) => BigInt(m.amount) - (BigInt(m.amount) * BigInt(p.retainage_bps)) / 10000n;
export const shortAcct = (a?: string) => (a ? a.replace('.testnet', '') : '');
