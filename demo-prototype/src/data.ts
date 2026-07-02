// All demo data hardcoded — realistic content modeled on the SEBI Master Circular
// for Stock Brokers (May 22, 2024) + CSCRF. No backend; this file IS the backend.

export type Status = 'GREEN' | 'AMBER' | 'RED' | 'GREY';
export type TenantId = 'sharma' | 'mehta';

export interface Tenant {
  id: TenantId;
  name: string;
  short: string;
  qsb: boolean;
  tagline: string;
}

export const TENANTS: Tenant[] = [
  { id: 'sharma', name: 'Sharma Securities Pvt Ltd', short: 'Sharma Securities', qsb: true, tagline: 'Qualified Stock Broker · NSE, BSE · 2.1L active clients' },
  { id: 'mehta', name: 'Mehta Broking LLP', short: 'Mehta Broking', qsb: false, tagline: 'Stock Broker · NSE · 14,200 active clients' },
];

export interface Obligation {
  id: string;
  title: string;
  cluster: string;
  x: number;
  y: number;
  rule: string;
  type: 'computable' | 'attestable';
  clauseRef: string;
  page: number;
  clauseText: string;
  highlight: string;
  confidence: number;
  attributes: string[];
  status: Record<TenantId, Status>;
  reason: Record<TenantId, string>;
  deadline?: string;
}

export const CLUSTERS: Record<string, { label: string; cx: number; cy: number }> = {
  kyc: { label: 'KYC & Onboarding', cx: 195, cy: 150 },
  funds: { label: 'Client Funds & Securities', cx: 555, cy: 128 },
  risk: { label: 'Risk & Margins', cx: 915, cy: 165 },
  cyber: { label: 'Cyber Security & Resilience', cx: 300, cy: 455 },
  grievance: { label: 'Grievance & Reporting', cx: 705, cy: 465 },
  gov: { label: 'Governance', cx: 1035, cy: 420 },
};

export const OBLIGATIONS: Obligation[] = [
  {
    id: 'kyc-cdd', title: 'Client due diligence before onboarding', cluster: 'kyc', x: 120, y: 105,
    rule: 'exists([KYC.cdd_record])', type: 'attestable',
    clauseRef: 'Ch. 2, para 2.1.4', page: 18,
    clauseText: 'Stock brokers shall carry out client due diligence as prescribed under the PMLA guidelines before opening a trading account, and shall maintain records of the same.',
    highlight: 'carry out client due diligence as prescribed under the PMLA guidelines before opening a trading account',
    confidence: 0.94, attributes: ['KYC.cdd_record'],
    status: { sharma: 'GREEN', mehta: 'GREEN' },
    reason: { sharma: 'CDD policy + records on file (updated 12-Apr-2026).', mehta: 'CDD policy + records on file (updated 03-Feb-2026).' },
  },
  {
    id: 'kyc-refresh', title: 'Periodic KYC refresh — 2 years', cluster: 'kyc', x: 268, y: 118,
    rule: 'days_since([KYC.last_refresh_date]) <= 730', type: 'computable',
    clauseRef: 'Ch. 2, para 2.6.2', page: 24,
    clauseText: 'KYC records of clients categorised as high risk shall be updated at least once in every two years.',
    highlight: 'updated at least once in every two years',
    confidence: 0.91, attributes: ['KYC.last_refresh_date'],
    status: { sharma: 'GREEN', mehta: 'AMBER' },
    reason: { sharma: 'Last refresh 214 days ago; limit 730.', mehta: 'Refresh due in 12 days (718 days elapsed).' },
    deadline: '11 Jul 2026',
  },
  {
    id: 'aml-str', title: 'STR filing within 7 days of detection', cluster: 'kyc', x: 190, y: 215,
    rule: 'days_between([AML.detection_date],[AML.str_filed_date]) <= 7', type: 'computable',
    clauseRef: 'Ch. 2, para 2.9.1', page: 31,
    clauseText: 'Suspicious transaction reports shall be filed with FIU-IND within seven working days of detection of the suspicious transaction.',
    highlight: 'within seven working days of detection',
    confidence: 0.89, attributes: ['AML.detection_date', 'AML.str_filed_date'],
    status: { sharma: 'GREEN', mehta: 'GREEN' },
    reason: { sharma: 'Last STR filed in 3 days.', mehta: 'No pending STRs.' },
  },
  {
    id: 'cf-segregation', title: 'Daily segregation of client funds', cluster: 'funds', x: 470, y: 85,
    rule: '[Funds.client_bank_balance] >= [Funds.client_obligations]', type: 'computable',
    clauseRef: 'Ch. 4, para 4.3.1', page: 47,
    clauseText: 'Stock brokers shall maintain client funds in designated client bank accounts, fully segregated from proprietary funds, and shall report the segregation on a daily basis to the stock exchanges.',
    highlight: 'fully segregated from proprietary funds, and shall report the segregation on a daily basis',
    confidence: 0.93, attributes: ['Funds.client_bank_balance', 'Funds.client_obligations'],
    status: { sharma: 'GREEN', mehta: 'GREEN' },
    reason: { sharma: 'Segregation reported today; surplus ₹4.2 Cr.', mehta: 'Segregation reported today; surplus ₹38 L.' },
  },
  {
    id: 'cf-upstreaming', title: 'Upstreaming client funds to CC — daily EOD', cluster: 'funds', x: 622, y: 92,
    rule: '[Funds.upstreamed_pct] == 100', type: 'computable',
    clauseRef: 'Ch. 4, para 4.7.2', page: 55,
    clauseText: 'All client funds shall be upstreamed to the Clearing Corporation in the form of cash, FDRs, or units of overnight mutual funds by end of day.',
    highlight: 'upstreamed to the Clearing Corporation … by end of day',
    confidence: 0.9, attributes: ['Funds.upstreamed_pct'],
    status: { sharma: 'AMBER', mehta: 'GREEN' },
    reason: { sharma: '98.6% upstreamed yesterday — 1 FDR renewal pending (due today).', mehta: '100% upstreamed.' },
    deadline: '29 Jun 2026',
  },
  {
    id: 'cf-settlement', title: 'Running account settlement — 90 days', cluster: 'funds', x: 548, y: 195,
    rule: 'days_since([Funds.last_settlement_date]) <= 90', type: 'computable',
    clauseRef: 'Ch. 4, para 4.9.3', page: 61,
    clauseText: 'The running account of client funds shall be settled at least once in ninety days (thirty days if opted by the client), and the statement of settlement sent to the client.',
    highlight: 'settled at least once in ninety days',
    confidence: 0.92, attributes: ['Funds.last_settlement_date'],
    status: { sharma: 'GREEN', mehta: 'RED' },
    reason: { sharma: 'Settled 41 days ago.', mehta: '104 days since last settlement for 312 clients; limit 90.' },
  },
  {
    id: 'rm-margin', title: 'Daily margin reporting to exchanges', cluster: 'risk', x: 838, y: 118,
    rule: 'exists([Risk.margin_report_today])', type: 'computable',
    clauseRef: 'Ch. 5, para 5.2.1', page: 68,
    clauseText: 'Stock brokers shall report margin details of all clients to the stock exchanges on a daily basis in the prescribed format.',
    highlight: 'report margin details of all clients … on a daily basis',
    confidence: 0.95, attributes: ['Risk.margin_report_today'],
    status: { sharma: 'GREEN', mehta: 'GREEN' },
    reason: { sharma: 'Filed 06:12 IST today.', mehta: 'Filed 06:47 IST today.' },
  },
  {
    id: 'rm-exposure', title: 'Client exposure within limits', cluster: 'risk', x: 990, y: 130,
    rule: '[Risk.max_client_exposure_pct] <= 25', type: 'computable',
    clauseRef: 'Ch. 5, para 5.4.6', page: 74,
    clauseText: 'Exposure to any single client shall not exceed the limits prescribed by the risk management framework of the stock exchange.',
    highlight: 'shall not exceed the limits prescribed',
    confidence: 0.84, attributes: ['Risk.max_client_exposure_pct'],
    status: { sharma: 'GREEN', mehta: 'GREEN' },
    reason: { sharma: 'Max single-client exposure 11.4%.', mehta: 'Max single-client exposure 17.9%.' },
  },
  {
    id: 'rm-collateral', title: 'Client collateral segregation reporting', cluster: 'risk', x: 912, y: 230,
    rule: 'exists([Risk.collateral_report])', type: 'computable',
    clauseRef: 'Ch. 5, para 5.7.2', page: 81,
    clauseText: 'Stock brokers shall report disaggregated client-wise collateral data to the clearing corporations in the prescribed manner.',
    highlight: 'disaggregated client-wise collateral data',
    confidence: 0.88, attributes: ['Risk.collateral_report'],
    status: { sharma: 'GREY', mehta: 'GREEN' },
    reason: { sharma: 'No collateral report on file yet for the current cycle.', mehta: 'Reported 27-Jun-2026.' },
  },
  {
    id: 'cyb-audit', title: 'Cyber security audit — half-yearly', cluster: 'cyber', x: 232, y: 400,
    rule: 'days_since([CyberAudit.last_audit_date]) <= 182', type: 'computable',
    clauseRef: 'Ch. 9, para 9.3.1', page: 88,
    clauseText: 'Stock brokers shall conduct a comprehensive cyber audit at least once in every six months through a CERT-In empanelled auditing organisation. The findings of the audit along with the corrective action plan shall be reported to the stock exchanges within one month of completion of the audit.',
    highlight: 'at least once in every six months through a CERT-In empanelled auditing organisation',
    confidence: 0.92, attributes: ['CyberAudit.last_audit_date'],
    status: { sharma: 'GREEN', mehta: 'GREEN' },
    reason: { sharma: 'Last audit 101 days ago; limit 182.', mehta: 'Last audit 64 days ago; limit 182.' },
  },
  {
    id: 'cyb-vapt', title: 'VAPT findings closure — 90 days', cluster: 'cyber', x: 388, y: 402,
    rule: 'days_since([CyberAudit.vapt_report_date]) <= 90 OR [CyberAudit.vapt_closed] == True', type: 'computable',
    clauseRef: 'Ch. 9, para 9.4.3', page: 91,
    clauseText: 'Vulnerabilities identified in the VAPT exercise shall be remediated and closure reported within three months of the submission of the VAPT report.',
    highlight: 'remediated and closure reported within three months',
    confidence: 0.87, attributes: ['CyberAudit.vapt_report_date', 'CyberAudit.vapt_closed'],
    status: { sharma: 'GREEN', mehta: 'GREEN' },
    reason: { sharma: 'All 7 findings closed in 38 days.', mehta: '2 open findings, 51 days elapsed; within limit.' },
  },
  {
    id: 'cyb-policy', title: 'Board-approved cyber security policy', cluster: 'cyber', x: 245, y: 512,
    rule: 'exists([CyberAudit.policy_document])', type: 'attestable',
    clauseRef: 'Ch. 9, para 9.1.2', page: 85,
    clauseText: 'Stock brokers shall formulate a comprehensive cyber security and cyber resilience policy document, approved by their Board of Directors, and review it annually.',
    highlight: 'approved by their Board of Directors, and review it annually',
    confidence: 0.96, attributes: ['CyberAudit.policy_document'],
    status: { sharma: 'GREEN', mehta: 'GREY' },
    reason: { sharma: 'Policy v4.1 on file, board-approved 18-Jan-2026.', mehta: 'No policy document uploaded for FY 26-27 review.' },
  },
  {
    id: 'cyb-soc', title: 'Security log retention — 2 years', cluster: 'cyber', x: 372, y: 508,
    rule: '[CyberAudit.log_retention_months] >= 24', type: 'computable',
    clauseRef: 'Ch. 9, para 9.6.1', page: 94,
    clauseText: 'Logs of security events shall be retained for a rolling period of not less than two years and made available to SEBI or the exchanges on demand.',
    highlight: 'retained for a rolling period of not less than two years',
    confidence: 0.9, attributes: ['CyberAudit.log_retention_months'],
    status: { sharma: 'GREEN', mehta: 'GREEN' },
    reason: { sharma: 'Retention configured: 36 months.', mehta: 'Retention configured: 24 months.' },
  },
  {
    id: 'gr-scores', title: 'SCORES complaint resolution — 21 days', cluster: 'grievance', x: 632, y: 415,
    rule: 'max([Grievance.open_complaint_age_days]) <= 21', type: 'computable',
    clauseRef: 'Ch. 11, para 11.2.4', page: 112,
    clauseText: 'Complaints received through the SCORES platform shall be resolved within twenty-one calendar days of receipt, failing which the matter shall be escalated as per the prescribed matrix.',
    highlight: 'resolved within twenty-one calendar days of receipt',
    confidence: 0.93, attributes: ['Grievance.open_complaint_age_days'],
    status: { sharma: 'GREEN', mehta: 'GREEN' },
    reason: { sharma: '2 open complaints, oldest 6 days.', mehta: '1 open complaint, 11 days.' },
  },
  {
    id: 'gr-report', title: 'Monthly investor grievance report', cluster: 'grievance', x: 782, y: 428,
    rule: 'exists([Grievance.monthly_report])', type: 'computable',
    clauseRef: 'Ch. 11, para 11.5.1', page: 118,
    clauseText: 'Stock brokers shall submit a report on investor grievances received and redressed to the stock exchanges on a monthly basis.',
    highlight: 'report on investor grievances … on a monthly basis',
    confidence: 0.91, attributes: ['Grievance.monthly_report'],
    status: { sharma: 'GREEN', mehta: 'GREEN' },
    reason: { sharma: 'June report filed 02-Jun-2026.', mehta: 'June report filed 04-Jun-2026.' },
  },
  {
    id: 'gov-networth', title: 'Net worth certificate — half-yearly', cluster: 'gov', x: 968, y: 372,
    rule: 'days_since([Governance.networth_cert_date]) <= 182', type: 'computable',
    clauseRef: 'Ch. 1, para 1.8.2', page: 12,
    clauseText: 'Stock brokers shall submit a net worth certificate certified by a chartered accountant to the stock exchanges on a half-yearly basis.',
    highlight: 'net worth certificate … on a half-yearly basis',
    confidence: 0.94, attributes: ['Governance.networth_cert_date'],
    status: { sharma: 'GREEN', mehta: 'GREEN' },
    reason: { sharma: 'Certificate dated 12-Apr-2026 (78 days ago).', mehta: 'Certificate dated 30-Apr-2026 (60 days ago).' },
  },
  {
    id: 'gov-co', title: 'Designated compliance officer', cluster: 'gov', x: 1098, y: 452,
    rule: 'exists([Governance.compliance_officer])', type: 'attestable',
    clauseRef: 'Ch. 1, para 1.5.1', page: 9,
    clauseText: 'Every stock broker shall appoint a compliance officer who shall be responsible for monitoring compliance with the Act, rules and regulations, and for redressal of investor grievances.',
    highlight: 'shall appoint a compliance officer',
    confidence: 0.97, attributes: ['Governance.compliance_officer'],
    status: { sharma: 'GREEN', mehta: 'GREEN' },
    reason: { sharma: 'R. Iyer registered since 2021.', mehta: 'P. Mehta registered since 2019.' },
  },
];

export const EDGES: { from: string; to: string; type: string }[] = [
  { from: 'cf-upstreaming', to: 'cf-segregation', type: 'depends_on' },
  { from: 'cf-settlement', to: 'cf-segregation', type: 'depends_on' },
  { from: 'rm-collateral', to: 'cf-segregation', type: 'depends_on' },
  { from: 'cyb-vapt', to: 'cyb-audit', type: 'depends_on' },
  { from: 'cyb-soc', to: 'cyb-policy', type: 'depends_on' },
  { from: 'gr-report', to: 'gr-scores', type: 'shared_evidence' },
  { from: 'rm-margin', to: 'rm-exposure', type: 'shared_evidence' },
  { from: 'kyc-refresh', to: 'kyc-cdd', type: 'depends_on' },
];

// ── The amendment (the hero) ─────────────────────────────────────────────────
export const AMENDMENT = {
  circular: 'SEBI/HO/MIRSD/TPD/P/CIR/2026/47',
  date: '29 Jun 2026',
  title: 'Amendment — Cyber Security & Cyber Resilience Framework for Qualified Stock Brokers',
  clauseText: 'In partial modification of para 9.3.1 of the Master Circular, Qualified Stock Brokers (QSBs) shall conduct the comprehensive cyber audit on a quarterly basis, i.e., at least once in every ninety days.',
  highlight: 'Qualified Stock Brokers (QSBs) shall conduct the comprehensive cyber audit on a quarterly basis',
  targetId: 'cyb-audit',
  classification: 'SPLIT',
  diff: { field: 'audit frequency', from: '182 days — all stock brokers', to: '90 days — QSBs · 182 days — others' },
  impact: [
    { tenant: 'Sharma Securities (QSB)', from: 'GREEN', to: 'RED', note: 'Last audit 101 days ago → breaches new 90-day limit' },
    { tenant: 'Mehta Broking (non-QSB)', from: 'GREEN', to: 'GREEN', note: 'Unaffected — remains on 182-day cycle' },
  ],
  splitNodes: [
    {
      id: 'cyb-audit-qsb', title: 'Cyber audit — QSB · quarterly', x: 175, y: 372,
      rule: 'days_since([CyberAudit.last_audit_date]) <= 90',
      status: { sharma: 'RED', mehta: 'GREY' } as Record<TenantId, Status>,
      reason: { sharma: 'Last audit 101 days ago; QSB limit is now 90.', mehta: 'Not applicable (non-QSB).' } as Record<TenantId, string>,
    },
    {
      id: 'cyb-audit-rest', title: 'Cyber audit — others · half-yearly', x: 295, y: 358,
      rule: 'days_since([CyberAudit.last_audit_date]) <= 182',
      status: { sharma: 'GREY', mehta: 'GREEN' } as Record<TenantId, Status>,
      reason: { sharma: 'Not applicable (QSB).', mehta: 'Last audit 64 days ago; limit 182.' } as Record<TenantId, string>,
    },
  ],
};

export const PIPELINE_STAGES = [
  { label: 'Parsing document structure', detail: '241 clauses · 14 tables · 6 annexures', ms: 900 },
  { label: 'Extracting obligations', detail: '17 obligations drafted as executable rules', ms: 1300 },
  { label: 'Resolving attributes', detail: '21 canonical · 3 aliased · 0 duplicates created', ms: 1100 },
  { label: 'Confidence gate', detail: '15 auto-approved · 2 routed to human review', ms: 800 },
];

export const AUDIT_LOG = [
  { seq: 5009, event: 'CIRCULAR_INGESTED', actor: 'system', detail: 'Master Circular MIRSD/2024/70 · 241 clauses parsed', ts: '22 Jun 2026 · 10:02:11', hash: 'e4f7…b3d9' },
  { seq: 5010, event: 'OBLIGATIONS_PUBLISHED', actor: 'r.verma@sebi.gov.in', detail: '17 obligations approved & published to the canonical graph', ts: '22 Jun 2026 · 11:47:03', hash: '9c2b…aa01' },
  { seq: 5011, event: 'FACTS_UPDATED', actor: 'compliance@sharmasec.in', detail: 'CyberAudit.last_audit_date = 20-Mar-2026', ts: '24 Jun 2026 · 09:15:44', hash: '71ac…04de' },
  { seq: 5012, event: 'AMENDMENT_DETECTED', actor: 'system', detail: 'CIR/2026/47 → matched para 9.3.1 · classified SPLIT · confidence 0.90', ts: '29 Jun 2026 · 14:21:36', hash: 'bb31…7f22' },
  { seq: 5013, event: 'CHANGE_SET_APPROVED', actor: 'r.verma@sebi.gov.in', detail: 'cyb-audit split → QSB 90d / others 182d · 2 tenants re-evaluated', ts: '29 Jun 2026 · 14:23:05', hash: '5d90…c6e8' },
];

export const STATUS_COLOR: Record<Status, string> = {
  GREEN: '#10B981',
  AMBER: '#F59E0B',
  RED: '#EF4444',
  GREY: '#64748B',
};

export const STATUS_LABEL: Record<Status, string> = {
  GREEN: 'Compliant',
  AMBER: 'At risk',
  RED: 'Non-compliant',
  GREY: 'No data',
};

// SEBI network view: worst status across tenants (regulator heat view)
export function networkStatus(o: { status: Record<TenantId, Status> }): Status {
  const order: Status[] = ['RED', 'AMBER', 'GREY', 'GREEN'];
  for (const s of order) if (Object.values(o.status).includes(s)) return s;
  return 'GREEN';
}

// ─────────────────────────────────────────────────────────────────────────────
// REGULATOR ECOSYSTEM VIEW — the "Living Regulatory Brain"
// SEBI oversees 237 regulated intermediaries. Each obligation has a live
// compliance footprint across all of them. This layer drives the graph.
// ─────────────────────────────────────────────────────────────────────────────

export type AmendPhase = 'idle' | 'analyzing' | 'proposed' | 'approved';

export const TOTAL_ENTITIES = 237;

export interface EntityStat {
  compliant: number;
  atRisk: number;
  breach: number;
  noData: number;
}

// Per-obligation footprint across all 237 entities (sums to 237).
export const ENTITY_STATS: Record<string, EntityStat> = {
  'kyc-cdd':        { compliant: 228, atRisk: 7,  breach: 0,  noData: 2 },
  'kyc-refresh':    { compliant: 218, atRisk: 16, breach: 1,  noData: 2 },
  'aml-str':        { compliant: 225, atRisk: 10, breach: 0,  noData: 2 },
  'cf-segregation': { compliant: 230, atRisk: 6,  breach: 0,  noData: 1 },
  'cf-upstreaming': { compliant: 216, atRisk: 17, breach: 2,  noData: 2 },
  'cf-settlement':  { compliant: 218, atRisk: 15, breach: 3,  noData: 1 },
  'rm-margin':      { compliant: 200, atRisk: 31, breach: 4,  noData: 2 },
  'rm-exposure':    { compliant: 171, atRisk: 48, breach: 15, noData: 3 },
  'rm-collateral':  { compliant: 70,  atRisk: 9,  breach: 0,  noData: 158 },
  'cyb-audit':      { compliant: 137, atRisk: 60, breach: 36, noData: 4 },
  'cyb-vapt':       { compliant: 171, atRisk: 48, breach: 15, noData: 3 },
  'cyb-policy':     { compliant: 171, atRisk: 47, breach: 16, noData: 3 },
  'cyb-soc':        { compliant: 147, atRisk: 55, breach: 32, noData: 3 },
  'gr-scores':      { compliant: 214, atRisk: 21, breach: 0,  noData: 2 },
  'gr-report':      { compliant: 214, atRisk: 20, breach: 1,  noData: 2 },
  'gov-networth':   { compliant: 214, atRisk: 20, breach: 1,  noData: 2 },
  'gov-co':         { compliant: 220, atRisk: 17, breach: 0,  noData: 2 },
};

// Short node labels + one-line AI reasoning (the "✨ Why?" explanation).
export const OBLIGATION_META: Record<string, { short: string; aiWhy: string }> = {
  'kyc-cdd':        { short: 'Client Due Diligence', aiWhy: 'Strong. 228 of 237 entities hold complete CDD records; the 9 exceptions are newly-registered brokers still inside their onboarding window.' },
  'kyc-refresh':    { short: 'Periodic KYC Refresh', aiWhy: 'Healthy. 218 entities are within the 2-year refresh cycle. 16 are nearing the 730-day limit and have been auto-notified.' },
  'aml-str':        { short: 'STR Filing · 7 days', aiWhy: 'Strong. No entity has a suspicious-transaction report pending beyond the 7-day statutory window this quarter.' },
  'cf-segregation': { short: 'Fund Segregation', aiWhy: 'Excellent. 230 entities reported daily client-fund segregation today with zero shortfall.' },
  'cf-upstreaming': { short: 'Daily Upstreaming', aiWhy: 'Healthy. 216 entities upstreamed 100% of client funds by EOD; 17 had minor FDR-renewal lags, now cleared.' },
  'cf-settlement':  { short: 'Running Acct Settlement', aiWhy: 'Healthy. 218 entities settled running accounts within 90 days; 3 breached and were flagged to the exchange.' },
  'rm-margin':      { short: 'Daily Margin Reporting', aiWhy: 'At risk. 200 entities file margin reports on time; 31 filed late at least once this month and 4 missed a filing.' },
  'rm-exposure':    { short: 'Client Exposure Limits', aiWhy: 'At risk. 171 entities are within single-client exposure limits; 48 sit near the 25% ceiling and 15 breached intraday.' },
  'rm-collateral':  { short: 'Collateral Reporting', aiWhy: 'No data. 158 entities have not filed disaggregated client-collateral reports this cycle — coverage is insufficient to score.' },
  'cyb-audit':      { short: 'Cyber Audit', aiWhy: 'Breach. Only 137 of 237 entities completed a cyber audit within 182 days. 36 are overdue and 60 are within 30 days of lapse — the highest-risk obligation in the graph.' },
  'cyb-vapt':       { short: 'VAPT Closure', aiWhy: 'At risk. 171 entities closed VAPT findings within 90 days; 48 have open findings nearing the limit and 15 have breached.' },
  'cyb-policy':     { short: 'Cyber Policy', aiWhy: 'At risk. 171 entities hold a board-approved cyber policy; 47 are pending FY 26-27 review and 16 have none on file.' },
  'cyb-soc':        { short: 'Log Retention · 2yr', aiWhy: 'Breach. 147 entities meet the 2-year security-log retention rule; 55 fall short and 32 retain under 12 months.' },
  'gr-scores':      { short: 'SCORES Resolution', aiWhy: 'Healthy. 214 entities resolve SCORES complaints within 21 days; 21 have an ageing complaint under review.' },
  'gr-report':      { short: 'Grievance Report', aiWhy: 'Healthy. 214 entities filed the monthly grievance report on time; 1 is overdue this cycle.' },
  'gov-networth':   { short: 'Net-Worth Certificate', aiWhy: 'Healthy. 214 entities hold a valid half-yearly net-worth certificate; 1 has lapsed.' },
  'gov-co':         { short: 'Compliance Officer', aiWhy: 'Strong. 220 entities have a registered compliance officer; the rest are in leadership transition with interim officers.' },
};

// The 6 topic islands, in radial order (angle in degrees, 0 = right, clockwise).
// brand = icon tint; health/status are derived live from ENTITY_STATS.
export interface Topic {
  id: string;
  label: string;
  short: string;
  icon: string;      // lucide icon name, resolved in the component
  brand: string;     // icon accent colour (independent of health)
  angle: number;     // position around the central sphere
  blurb: string;
}

export const TOPICS: Topic[] = [
  { id: 'kyc',       label: 'KYC & Onboarding',           short: 'KYC',        icon: 'UserRound',  brand: '#10B981', angle: -90, blurb: 'Client identification, due diligence, periodic refresh and AML reporting at onboarding.' },
  { id: 'risk',      label: 'Risk & Margins',             short: 'Risk',       icon: 'BarChart3',  brand: '#F59E0B', angle: -30, blurb: 'Daily margin reporting, single-client exposure ceilings and collateral segregation.' },
  { id: 'gov',       label: 'Governance',                 short: 'Governance', icon: 'ShieldCheck',brand: '#3B82F6', angle:  30, blurb: 'Net-worth adequacy, designated compliance officer and board oversight duties.' },
  { id: 'grievance', label: 'Grievance & Reporting',      short: 'Grievance',  icon: 'FileText',   brand: '#8B5CF6', angle:  90, blurb: 'SCORES complaint resolution timelines and periodic investor-grievance reporting.' },
  { id: 'cyber',     label: 'Cyber Security & Resilience',short: 'Cyber',      icon: 'ShieldAlert',brand: '#EF4444', angle: 150, blurb: 'Cyber audits, VAPT closure, board-approved policy and security-log retention.' },
  { id: 'funds',     label: 'Client Funds & Securities',  short: 'Funds',      icon: 'Landmark',   brand: '#059669', angle: 210, blurb: 'Segregation of client funds, daily upstreaming to the CC and running-account settlement.' },
];

// Regulator status of a single obligation across the whole ecosystem.
export function regStatus(id: string): Status {
  const s = ENTITY_STATS[id];
  if (!s) return 'GREY';
  if (s.noData / TOTAL_ENTITIES >= 0.5) return 'GREY';
  const pct = (s.compliant / TOTAL_ENTITIES) * 100;
  return pct >= 90 ? 'GREEN' : pct >= 70 ? 'AMBER' : 'RED';
}

export function obligationPct(id: string): number {
  const s = ENTITY_STATS[id];
  if (!s) return 0;
  return Math.round((s.compliant / TOTAL_ENTITIES) * 100);
}

export function topicObligations(topicId: string) {
  return OBLIGATIONS.filter((o) => o.cluster === topicId);
}

// Topic health = mean compliance of its scored (non-GREY) obligations.
export function topicHealth(topicId: string): number {
  const scored = topicObligations(topicId).filter((o) => regStatus(o.id) !== 'GREY');
  if (!scored.length) return 0;
  return Math.round(scored.reduce((a, o) => a + obligationPct(o.id), 0) / scored.length);
}

export function healthStatus(pct: number): Status {
  return pct >= 90 ? 'GREEN' : pct >= 70 ? 'AMBER' : 'RED';
}

// Ecosystem summary counts for the stat cards — computed, always consistent.
export function ecosystemSummary() {
  const counts = { GREEN: 0, AMBER: 0, RED: 0, GREY: 0 } as Record<Status, number>;
  for (const o of OBLIGATIONS) counts[regStatus(o.id)]++;
  return counts;
}

// ── Time Machine — compliance evolution across snapshots ─────────────────────
export interface Snapshot {
  label: string;
  // per-topic health at this point in time
  health: Record<string, number>;
  breaches: number; // obligations in breach ecosystem-wide
}

export const TIMELINE: Snapshot[] = [
  { label: 'Jan 2024', health: { kyc: 82, risk: 64, gov: 79, grievance: 78, cyber: 48, funds: 80 }, breaches: 5 },
  { label: 'Apr 2024', health: { kyc: 86, risk: 68, gov: 83, grievance: 82, cyber: 54, funds: 84 }, breaches: 4 },
  { label: 'Jul 2024', health: { kyc: 89, risk: 72, gov: 87, grievance: 86, cyber: 59, funds: 88 }, breaches: 4 },
  { label: 'Oct 2024', health: { kyc: 92, risk: 75, gov: 89, grievance: 88, cyber: 63, funds: 91 }, breaches: 3 },
  { label: 'Today',    health: { kyc: 94, risk: 78, gov: 91, grievance: 90, cyber: 66, funds: 93 }, breaches: 2 },
];

export function overallCompliance(health: Record<string, number>): number {
  let sum = 0, n = 0;
  for (const t of TOPICS) {
    const c = topicObligations(t.id).length;
    sum += (health[t.id] ?? topicHealth(t.id)) * c;
    n += c;
  }
  return Math.round(sum / n);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE AMENDMENT CONSOLE — an incoming circular → governed, live change
// A self-contained amendment lifecycle used by the Amendment Console screen.
// ─────────────────────────────────────────────────────────────────────────────

export interface DiffRule {
  id: string;
  obligation: string;
  clauseRef: string;
  page: number;
  changeKind: 'Modified' | 'New rule' | 'Tightened';
  oldVer: string | null;
  newVer: string;
  summary: string;                                   // one-line change for the grid row
  old: { expr: string; clause: string } | null;     // null when brand-new
  next: { expr: string; clause: string };
  impacted: { breach: number; atRisk: number; noChange: number };
}

export interface AffectedEntity {
  name: string;
  kind: string;
  from: Status;
  to: Status;
  note: string;
}

export const AMENDMENT_STEPS = [
  { id: 'detected', label: 'Detected', sub: 'Circular received' },
  { id: 'analyzed', label: 'Analyzed', sub: 'AI parsing & diffing' },
  { id: 'interpreted', label: 'Interpreted', sub: 'Change proposed' },
  { id: 'review', label: 'Review', sub: 'Maker check' },
  { id: 'approved', label: 'Approved', sub: 'Checker sign-off' },
  { id: 'committed', label: 'Committed', sub: 'Live on graph' },
];

export const INCIDENT_AMENDMENT = {
  circular: 'SEBI/HO/MIRSD/MIRSD-PoD-1/P/CIR/2024/113',
  date: '21 May 2024',
  title: 'Strengthening of norms for Cyber Resilience and Incident Reporting by Market Infrastructure Institutions (MIIs)',
  classification: 'Modification',
  impactedObligation: 'Cyber Incident Reporting',
  mappedClause: '5.2.1',
  confidence: 0.94,
  reasoning:
    'The circular amends the incident-reporting timeline from 6 hours to 2 hours, introduces a mandatory High / Medium / Low severity classification per Annex A, and tightens the root-cause-analysis submission window from 30 to 21 days. Three existing obligations under Cyber Resilience are affected.',

  rules: [
    {
      id: 'inc-report',
      obligation: 'Cyber Incident Reporting',
      clauseRef: '5.2.1', page: 12, changeKind: 'Modified',
      oldVer: 'v2.1', newVer: 'v2.2',
      summary: 'Reporting window 6 hrs → 2 hrs',
      old: {
        expr: 'hours_between([Incident.detected_at],[Incident.reported_at]) <= 6',
        clause: 'MIIs shall report cyber incidents to SEBI within six hours of detection of the incident.',
      },
      next: {
        expr: 'hours_between([Incident.detected_at],[Incident.reported_at]) <= 2',
        clause: 'MIIs shall report cyber incidents to SEBI within two hours of detection and classify the incident as High, Medium or Low based on the criteria specified in Annex A.',
      },
      impacted: { breach: 18, atRisk: 31, noChange: 79 },
    },
    {
      id: 'inc-severity',
      obligation: 'Incident Severity Classification',
      clauseRef: '5.2.3', page: 13, changeKind: 'New rule',
      oldVer: null, newVer: 'v1.0',
      summary: 'New — classify incidents High / Medium / Low',
      old: null,
      next: {
        expr: 'exists([Incident.severity]) AND [Incident.severity] IN {High, Medium, Low}',
        clause: 'Every reported incident shall be classified as High, Medium or Low based on the impact criteria defined in Annex A of this circular.',
      },
      impacted: { breach: 0, atRisk: 22, noChange: 106 },
    },
    {
      id: 'inc-rca',
      obligation: 'Root-Cause Analysis Submission',
      clauseRef: '5.2.5', page: 15, changeKind: 'Tightened',
      oldVer: 'v1.4', newVer: 'v1.5',
      summary: 'RCA submission 30 days → 21 days',
      old: {
        expr: 'days_between([Incident.closed_at],[RCA.submitted_at]) <= 30',
        clause: 'The root cause analysis report shall be submitted to the stock exchanges within thirty days of closure of the incident.',
      },
      next: {
        expr: 'days_between([Incident.closed_at],[RCA.submitted_at]) <= 21',
        clause: 'The root cause analysis report shall be submitted within twenty-one days of closure of the incident.',
      },
      impacted: { breach: 4, atRisk: 14, noChange: 110 },
    },
  ] as DiffRule[],

  impact: { affected: 128, total: 237, toBreach: 18, toAtRisk: 47, noChange: 63 },
  complianceCurrent: 66,
  complianceProjected: 62,
  trend: [
    { label: 'May 18', v: 65 }, { label: 'May 19', v: 66 }, { label: 'May 20', v: 66 },
    { label: 'May 21', v: 66, today: true }, { label: 'May 22', v: 62, proj: true },
  ] as { label: string; v: number; today?: boolean; proj?: boolean }[],

  entities: [
    { name: 'BSE Ltd', kind: 'Stock Exchange', from: 'AMBER', to: 'RED', note: 'Median incident report filed in 4.5 hrs — exceeds the new 2-hr window.' },
    { name: 'Metropolitan Stock Exchange', kind: 'Stock Exchange', from: 'GREEN', to: 'AMBER', note: 'No severity-classification field captured in incident records yet.' },
    { name: 'CDSL', kind: 'Depository', from: 'AMBER', to: 'RED', note: 'Last two incidents reported in 3.1 hrs and 5.4 hrs.' },
    { name: 'Multi Commodity Exchange (MCX)', kind: 'Commodity Exchange', from: 'GREEN', to: 'AMBER', note: 'RCA submitted in 27 days on last incident — over the new 21-day limit.' },
    { name: 'NSDL', kind: 'Depository', from: 'GREEN', to: 'GREEN', note: 'Already reports within 2 hrs and classifies severity — no change.' },
    { name: 'Indian Clearing Corporation', kind: 'Clearing Corp', from: 'GREEN', to: 'GREEN', note: 'Compliant on all three tightened rules.' },
    { name: 'NSE Clearing (NSCCL)', kind: 'Clearing Corp', from: 'AMBER', to: 'RED', note: 'Incident severity not recorded in the last review cycle.' },
    { name: 'NCDEX', kind: 'Commodity Exchange', from: 'GREEN', to: 'AMBER', note: 'Reporting median 1.8 hrs but RCA window now breached.' },
  ] as AffectedEntity[],
  entitiesTotal: 128,

  audit: {
    eventType: 'Amendment Proposed',
    proposedBy: 'AI System (Setu-NLP)',
    proposedOn: '21 May 2024, 10:24 AM IST',
    hash: '9f3a7c2b5e…d9a1f4bbc2',
    newVersion: 'Cyber Incident Reporting v2.2',
  },

  approver: { name: 'A. Deshpande', role: 'Senior Manager · MIRSD', initials: 'AD' },
};
