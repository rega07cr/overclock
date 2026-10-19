export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // API salute per il deploy
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, app: 'overclock', version: '1.3.0' });
    }
    // Tutto il resto: asset statici (landing + desktop demo)
    return env.ASSETS.fetch(request);
  }
};
