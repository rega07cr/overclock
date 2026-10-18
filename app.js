// OS detection + download routing + 3D tilt + counters
(function(){
  // Dopo il push su GitHub: scrivi qui 'tuo-nome/overclock' e i download
  // punteranno alla pagina Releases (exe compilati dalla CI). Vuoto = file locali.
  const GITHUB_REPO = 'rega07cr/overclock';
  const ua = navigator.userAgent;
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  let os = 'win', label = 'Download for Windows (x64)', file = 'releases/overclock-1.0.0-win-setup.exe';
  if (/Mac|darwin/i.test(platform + ua)) { os = 'mac'; label = 'Download for macOS (Universal)'; file = 'releases/overclock-1.0.0-mac-universal.dmg'; }
  else if (/Linux|X11/i.test(platform + ua)) { os = 'linux'; label = 'Download for Linux (.AppImage)'; file = 'releases/overclock-1.0.0-linux.AppImage'; }
  const releasePage = GITHUB_REPO && !/TUO-NOME|USERNAME|ESEMPIO/i.test(GITHUB_REPO)
    ? 'https://github.com/' + GITHUB_REPO + '/releases/latest' : null;
  if (releasePage) {
    file = releasePage; // pagina release: non si rompe mai, nomi asset sempre giusti
    document.querySelectorAll('a[href^="releases/"]').forEach(a => { a.href = releasePage; a.removeAttribute('download'); });
  }
  const names = { win: 'Windows 🪟', mac: 'macOS 🍎', linux: 'Linux 🐧' };
  const heroLabel = document.getElementById('heroDlLabel');
  const heroSub = document.getElementById('heroDlSub');
  const osDet = document.getElementById('osDetected');
  if (heroLabel) heroLabel.textContent = '⬇ ' + label;
  if (heroSub) heroSub.textContent = file;
  if (osDet) osDet.textContent = names[os];
  document.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', () => { window.location.href = file; }));
  const card = { win: 'dl-win', mac: 'dl-mac', linux: 'dl-linux' }[os];
  const el = document.getElementById(card);
  if (el) el.classList.add('highlight');

  // 3D tilt
  const mock = document.getElementById('mock3d');
  if (mock && matchMedia('(pointer:fine)').matches) {
    document.querySelector('.hero-visual').addEventListener('mousemove', e => {
      const r = mock.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      mock.style.transform = `perspective(1100px) rotateY(${-10 + x*14}deg) rotateX(${6 - y*14}deg)`;
    });
  }
  // counters
  document.querySelectorAll('[data-count]').forEach(n => {
    const target = +n.dataset.count; const t0 = performance.now();
    (function tick(t){ const p = Math.min(1, (t - t0) / 1400);
      n.textContent = Math.floor(target * (1 - Math.pow(1 - p, 3))).toLocaleString('en-US');
      if (p < 1) requestAnimationFrame(tick); })(t0);
  });
  const sha = document.getElementById('copySha');
  if (sha) sha.addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('shaBox').textContent).then(()=> sha.textContent = 'Copiato ✓');
  });
})();
