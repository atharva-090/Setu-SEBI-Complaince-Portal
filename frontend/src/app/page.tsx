'use client';

import { useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

export default function Home() {
  const [status, setStatus] = useState('not checked');
  const [detail, setDetail] = useState('');

  async function ping() {
    setStatus('checking…');
    setDetail('');
    try {
      const res = await fetch(`${API}/health`);
      const json = await res.json();
      setStatus(json.status ?? 'unknown');
      setDetail(JSON.stringify(json, null, 2));
    } catch (e) {
      setStatus('unreachable');
      setDetail(String(e));
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-10">
      <header>
        <h1 className="text-2xl font-bold">Setu</h1>
        <p className="text-neutral-500">SEBI Compliance Portal — M0 scaffold</p>
      </header>

      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={ping}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700"
          >
            Ping backend
          </button>
          <span className="text-sm">
            Backend:{' '}
            <strong
              className={
                status === 'ok'
                  ? 'text-green-600'
                  : status === 'unreachable' || status === 'degraded'
                    ? 'text-red-600'
                    : 'text-neutral-600'
              }
            >
              {status}
            </strong>
          </span>
        </div>
        <pre className="overflow-auto rounded-lg bg-neutral-100 p-3 text-xs text-neutral-700">
          {detail || '— click ping —'}
        </pre>
        <p className="mt-3 text-xs text-neutral-400">API: {API}</p>
      </section>
    </main>
  );
}
