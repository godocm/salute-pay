// Neon strips client-provided X-Neon-* headers before routing requests.
// The trigger header is therefore trusted only behind Neon's Functions gateway.
export default {
  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/')
      return new Response('Not found', { status: 404 });
    if (!request.headers.get('x-neon-trigger-invocation-id'))
      return new Response('Scheduled trigger required', { status: 403 });
    const origin = process.env.APP_ORIGIN;
    const secret = process.env.CRON_SECRET;
    if (!origin || !secret || new URL(origin).protocol !== 'https:')
      return new Response('Job configuration required', { status: 503 });
    let occurrence;
    try {
      occurrence = await request.json();
      if (!occurrence.data?.scheduled_at) throw Error('Missing occurrence');
    } catch {
      return new Response('Invalid scheduled occurrence', { status: 400 });
    }
    const started = Date.now();
    try {
      const response = await fetch(new URL('/api/jobs', origin), {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` },
        redirect: 'error',
        signal: AbortSignal.timeout(240000),
      });
      const result = response.ok ? await response.json() : null;
      const watcherErrors = Number(result?.watcher?.errors || 0);
      const ok = response.ok && watcherErrors === 0;
      console.log(JSON.stringify({
        event: 'salute.jobs', scheduledAt: occurrence.data.scheduled_at,
        status: response.status, watcherErrors, elapsedMs: Date.now() - started,
      }));
      if (!response.ok) await response.body?.cancel();
      return Response.json({ ok, status: response.status, watcherErrors }, {
        status: ok ? 200 : 502,
      });
    } catch {
      console.log(JSON.stringify({
        event: 'salute.jobs', scheduledAt: occurrence.data.scheduled_at,
        status: 'failed', elapsedMs: Date.now() - started,
      }));
      return Response.json({ ok: false }, { status: 502 });
    }
  },
};
