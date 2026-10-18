export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // API salute per il deploy
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, app: 'overclock', version: '1.0.1' });
    }
    // Tutto il resto: asset statici (landing + desktop demo)
    return env.ASSETS.fetch(request);
  }
};
