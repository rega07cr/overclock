// OVERCLOCK renderer — funziona in Electron (window.overclock) e come demo browser pura.
(function(){
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const isElectron = !!window.overclock;
  let kind = 'code', buff = 'speed', editor = null, selectedGame = null, PRESETS = [];

  // ---------- Livello ottimizzazione: Base / Media / Potente ----------
  let sysMode = 'media';
  try { sysMode = localStorage.getItem('oc-mode') || 'media'; } catch {}
  if (!['base', 'media', 'potente'].includes(sysMode)) sysMode = 'media';
  const MODE_HINT = {
    base: '🟢 Base: solo interventi sicuri (niente HKLM, niente piano energia, TEMP >7gg).',
    media: '🟡 Media: pulizia completa + registro HKCU reversibile. Consigliata.',
    potente: '🔴 Potente: tutto al massimo (HAGS, piano energia, ECN off). Alcuni tweak richiedono admin.'
  };
  function syncModeChips(){
    $$('.mode-chip').forEach(c => c.classList.toggle('on', c.dataset.mode === sysMode));
    const h = $('#modeHint'); if (h) h.textContent = MODE_HINT[sysMode];
  }

  // ---------- Intestazioni schede: testo fisso, mai modificato dalle ottimizzazioni ----------
  // Solo i box di log cambiano; titoli/descrizioni restano identici prima/dopo ogni azione.
  const frozenHeaders = new Map();
  function freezeHeaders(){
    $$('#view-system .sys-card h3, #view-system .sys-card > p:not(#gpuName), #view-system h2').forEach(el => {
      if (!frozenHeaders.has(el)) frozenHeaders.set(el, el.tagName === 'H2' ? el.innerHTML : el.textContent);
    });
    const g = $('#gpuName');
    if (g && /Rilevata:/.test(g.textContent) && !frozenHeaders.has(g)) frozenHeaders.set(g, g.textContent);
  }
  function enforceHeaders(){
    frozenHeaders.forEach((t, el) => {
      if (el.tagName === 'H2') { if (el.innerHTML !== t) el.innerHTML = t; }
      else if (el.textContent !== t) el.textContent = t;
    });
  }

  // ---------- Sidebar ----------
  $$('.side[data-view]').forEach(b => b.addEventListener('click', () => {
    $$('.side[data-view]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $$('.view').forEach(v => v.classList.remove('active'));
    $('#view-' + b.dataset.view).classList.add('active');
  }));

  // ---------- Monaco (CDN) con fallback textarea ----------
  function initEditor(){
    const fallback = $('#fallbackEdit');
    try {
      if (!window.require) throw 0;
      window.require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
      window.require(['vs/editor/editor.main'], () => {
        editor = monaco.editor.create($('#monaco'), {
          value: '// ⚡ Incolla qui il tuo codice...\nfunction slow(arr){\n  let out=[];\n  for(let i=0;i<arr.length;i++)\n    for(let j=0;j<arr.length;j++)\n      if(arr[i]===arr[j]) out.push(arr[i]);\n  return out;\n}',
          language: 'javascript', theme: 'vs-dark', minimap: { enabled: false }, fontSize: 13
        });
      }, () => { $('#monaco').style.display = 'none'; fallback.style.display = 'block'; });
    } catch { $('#monaco').style.display = 'none'; fallback.style.display = 'block'; }
    setTimeout(() => { if (!editor) { $('#monaco').style.display = 'none'; fallback.style.display = 'block'; } }, 4000);
  }
  function getInput(){
    if (editor) return editor.getValue();
    return $('#fallbackEdit').value || '// demo: incolla codice qui';
  }
  function setInput(v){ if (editor) editor.setValue(v); else $('#fallbackEdit').value = v; }

  $('#mCode').addEventListener('click', () => { kind='code'; $('#mCode').classList.add('active'); $('#mPrompt').classList.remove('active'); });
  $('#mPrompt').addEventListener('click', () => {
    kind='prompt'; $('#mPrompt').classList.add('active'); $('#mCode').classList.remove('active');
    setInput('fammi un sistema di login sicuro');
  });
  $$('.out-tabs .chip').forEach(b => b.addEventListener('click', () => {
    $$('.out-tabs .chip').forEach(x => x.classList.remove('on')); b.classList.add('on'); buff = b.dataset.buff;
  }));

  // ---------- AI Buff: Ollama -> fallback euristico ----------
  function heuristic(mode, k, input){
    if (k === 'prompt') return `🎯 ROLE: Agisci come senior expert.\n📌 OBIETTIVO: ${input.slice(0,220)}\n🧠 CHAIN-OF-THOUGHT: 1) riformula 2) vincoli 3) 3 approcci 4) scegli 5) output con esempi.\n✅ FORMATO: strutturato + criteri di accettazione.\n⚠️ Cita assunzioni, chiedi se ambiguo.`;
    if (mode === 'speed') return `// ⚡ SPEED BUFF (O(n), zero allocazioni)\nfunction fast(arr){\n  const seen = new Set(arr);\n  return [...seen];\n}\n// Cambi: ciclo O(n²) → Set O(n); rimossi push duplicati.\n// Input originale:\n// ${input.split('\n').join('\n// ').slice(0,600)}`;
    if (mode === 'sec') return `// 🛡️ SECURITY BUFF\n// - validato input (Array.isArray, tipi)\n// - nessuna eval/innerHTML, errori tipizzati\nfunction safe(arr){\n  if(!Array.isArray(arr)) throw new TypeError('atteso array');\n  return [...new Set(arr.filter(x => typeof x === 'number'))];\n}`;
    return `// 🧠 PRO SENIOR BUFF — pure, testabile, SRP\nconst dedupe = (arr) => {\n  if(!Array.isArray(arr)) throw new TypeError('atteso array');\n  return [...new Set(arr)];\n};\n// + test: assert(dedupe([1,1,2]).length===2)`;
  }

  $('#applyBtn').addEventListener('click', async () => {
    const input = getInput(), model = $('#modelSel').value;
    $('#output').textContent = '⚡ AI overclock in corso… (' + buff + ' / ' + model + ')';
    $('#engineMeta').textContent = 'engine: …';
    const btn = $('#applyBtn'); btn.classList.remove('cyber'); void btn.offsetWidth; btn.classList.add('cyber');
    try {
      const r = await fetch('http://localhost:11434/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: input, stream: false })
      });
      if (!r.ok) throw new Error('http ' + r.status);
      const d = await r.json();
      $('#output').textContent = d.response;
      $('#engineMeta').textContent = 'engine: ollama:' + model + ' (locale, privato)';
    } catch {
      await new Promise(r => setTimeout(r, 500)); // effetto cyber
      $('#output').textContent = heuristic(buff, kind, input);
      $('#engineMeta').textContent = 'engine: local-heuristic (Ollama offline — avvia `ollama serve` per l\u2019IA reale)';
    }
    refreshStats();
  });

  // ---------- System stats + booster ----------
  async function refreshStats(){
    let s = null;
    try { if (isElectron) s = await window.overclock.stats(); } catch {}
    if (!s) {
      const mem = performance.memory ? performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit : 0.42;
      s = { freePct: Math.round((1 - mem) * 100) || 42, tempC: 44 + Math.round(Math.random() * 6), fpsBoost: window.__fps || false };
    }
    $('#qStats').textContent = `[RAM: ${s.freePct}% Free] [CPU Temp: ${s.tempC}°C] [FPS Boost: ${s.fpsBoost ? 'ON' : 'OFF'}]`;
    $('#platLabel').textContent = isElectron ? window.overclock.platform : (navigator.platform + ' (demo browser)');
  }

  let gpuSnap = null, osSnap = null, gpuVendor = 'nvidia';
  const mark = r => ((r && r.preview) ? '' : (r && r.ok ? '✓ ' : '✕ ')) + ((r && r.out) || JSON.stringify(r).slice(0, 1200));
  // 👁 Anteprima system-booster (ram/processes/disk/network) — non modifica nulla
  $$('.mode-chip').forEach(c => c.addEventListener('click', () => {
    sysMode = c.dataset.mode;
    try { localStorage.setItem('oc-mode', sysMode); } catch {}
    syncModeChips();
  }));
  $$('[data-preview]').forEach(b => b.addEventListener('click', async () => {
    const a = b.dataset.preview;
    const log = document.querySelector(`[data-log="${a}"]`);
    log.textContent = '👁 leggo lo stato attuale…';
    if (isElectron) {
      try { log.textContent = mark(await window.overclock.previewSys(a, sysMode)); }
      catch(e){ log.textContent = '✕ ' + e.message; }
    } else log.textContent = `👁 Demo browser [${sysMode}]: qui vedresti cosa cambia prima di applicare.`;
    enforceHeaders();
  }));
  // ↩ Ripristina system-booster — rimette come prima
  $$('[data-restore]').forEach(b => b.addEventListener('click', async () => {
    const a = b.dataset.restore;
    const log = document.querySelector(`[data-log="${a}"]`);
    log.textContent = '↩ ripristino…';
    if (isElectron) {
      try { log.textContent = mark(await window.overclock.restoreSys(a)); }
      catch(e){ log.textContent = '✕ ' + e.message; }
    } else log.textContent = '↩ Demo browser: ripristino simulato.';
    enforceHeaders();
    refreshStats();
  }));
  // 👁 Anteprima tuning (gpu/os) — non modifica nulla
  $$('[data-tpreview]').forEach(b => b.addEventListener('click', async () => {
    const a = b.dataset.tpreview;
    const log = document.querySelector(`[data-log="${a}"]`);
    log.textContent = '👁 leggo lo stato attuale…';
    if (isElectron) {
      try { log.textContent = mark(await window.overclock.previewTune(a, sysMode)); }
      catch(e){ log.textContent = '✕ ' + e.message; }
    } else log.textContent = `👁 Demo browser [${sysMode}]: qui vedresti cosa cambia prima di applicare.`;
    enforceHeaders();
  }));
  const NEED_CONFIRM = { disk: 'disk', gpu: 'gpu', 'os-oc': 'os' };
  $$('[data-sys]').forEach(b => b.addEventListener('click', async () => {
    const a = b.dataset.sys;
    const logKey = a.startsWith('gpu') ? 'gpu' : (a.startsWith('os') ? 'os' : a);
    const log = document.querySelector(`[data-log="${logKey}"]`);
    // Prima di modificare: mostra cosa cambia e chiedi conferma (solo azioni che scrivono)
    if (isElectron && NEED_CONFIRM[a]) {
      try {
        const pv = a === 'gpu' || a === 'os-oc'
          ? await window.overclock.previewTune(a === 'gpu' ? 'gpu' : 'os', sysMode)
          : await window.overclock.previewSys(a, sysMode);
        const msg = (pv.out || '').slice(0, 900);
        if (!window.confirm(msg + '\n\nProcedere con la modifica? ("👁 Anteprima" la rivede senza modificare)')) {
          log.textContent = mark(pv);
          return;
        }
      } catch {}
    }
    log.textContent = '⏳ esecuzione…';
    if (isElectron) {
      try {
        let r;
        if (a === 'gpu') { r = await window.overclock.tune('gpu-boost', sysMode); gpuSnap = r.snap; }
        else if (a === 'gpu-restore') r = await window.overclock.tune('gpu-restore', gpuSnap);
        else if (a === 'gpu-panel') r = await window.overclock.tune('gpu-panel', { vendor: gpuVendor });
        else if (a === 'os-oc') { r = await window.overclock.tune('os-oc', sysMode); osSnap = r.snap; }
        else if (a === 'os-restore') r = await window.overclock.tune('os-restore', osSnap);
        else r = await window.overclock.runSys(a, sysMode);
        log.textContent = mark(r);
        if (r && r.ok) window.__fps = true;
      }
      catch(e){ log.textContent = '✕ ' + e.message; }
    } else {
      await new Promise(r => setTimeout(r, 700));
      const msgs = { ram: '✓ RAM flush simulato: +1.2 GB liberi', processes: '✓ 14 processi background → BelowNormal', disk: '✓ 840 MB temp/cache rimossi', network: '✓ DNS flushed, RTT 28ms → 19ms', gpu: '✓ GPU boost simulato (demo browser)', 'gpu-restore': '↩ GPU ripristinata (demo)', 'gpu-panel': 'ℹ Demo: il pannello vendor si apre nell\'app reale', 'os-oc': '✓ Overclock OS simulato (demo)', 'os-restore': '↩ OS ripristinato (demo)' };
      log.textContent = (msgs[a] || '…') + ` [${sysMode}]`; window.__fps = true;
    }
    enforceHeaders();
    refreshStats();
  }));
  async function loadTuning(){
    if (!isElectron) { $('#gpuName').textContent = 'Demo browser: GPU boost simulato.'; $('#startupList').textContent = 'Demo browser: lista avvio non disponibile.'; return; }
    try {
      const info = await window.overclock.tune('gpu-info');
      gpuVendor = info.vendor || 'nvidia';
      $('#gpuName').textContent = 'Rilevata: ' + (info.detail || info.vendor).split('\n')[0];
      freezeHeaders(); // congela il testo rilevato: le ottimizzazioni non lo cambieranno mai
      const s = await window.overclock.tune('startup-list');
      const box = $('#startupList'); box.innerHTML = '';
      if (!s.items.length) box.textContent = 'Nessun programma in avvio.';
      s.items.forEach(n => {
        const row = document.createElement('div'); row.className = 'st-row';
        row.innerHTML = `<span>${n}</span>`;
        const btn = document.createElement('button'); btn.className = 'ghost sm'; btn.textContent = 'Disabilita';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const r = await window.overclock.tune('startup-toggle', { name: n, enable: false });
          btn.textContent = r.ok ? 'Disabilitato ✓' : 'Errore';
        });
        row.appendChild(btn); box.appendChild(row);
      });
    } catch(e){ $('#gpuName').textContent = 'Errore rilevamento: ' + e.message; }
  }
  $('#fullPreview').addEventListener('click', async () => {
    const L = $('#fullLog'); L.textContent = '👁 leggo lo stato attuale…';
    if (isElectron) { try { L.textContent = mark(await window.overclock.previewSys('full', sysMode)); } catch(e){ L.textContent = '✕ ' + e.message; } }
    else L.textContent = `👁 Demo [${sysMode}]: full buff toccherebbe RAM + processi + disco + rete (dettagli nell\'app reale).`;
    enforceHeaders();
  });
  $('#fullRestore').addEventListener('click', async () => {
    const L = $('#fullLog'); L.textContent = '↩ ripristino tutto…';
    if (isElectron) { try { L.textContent = mark(await window.overclock.restoreSys('full')); } catch(e){ L.textContent = '✕ ' + e.message; } }
    else L.textContent = '↩ Demo: tutto ripristinato.';
    $('#boostStatus').textContent = '[Status: RIPRISTINATO ↩]';
    enforceHeaders();
    refreshStats();
  });
  $('#fullBuff').addEventListener('click', async () => {
    const L = $('#fullLog');
    if (isElectron) {
      try {
        const pv = await window.overclock.previewSys('full', sysMode);
        if (!window.confirm((pv.out || '').slice(0, 1200) + '\n\nProcedere con il FULL BUFF?')) { L.textContent = mark(pv); return; }
      } catch {}
    }
    L.textContent = '⚡ FULL SYSTEM BUFF in corso…';
    const btn = $('#fullBuff'); btn.classList.remove('cyber'); void btn.offsetWidth; btn.classList.add('cyber');
    $('#boostStatus').textContent = '[Status: BOOSTING… 🌀]';
    if (isElectron) {
      try { const r = await window.overclock.runSys('full', sysMode); L.textContent = JSON.stringify(r, null, 1).slice(0, 1500); }
      catch(e){ L.textContent = '✕ ' + e.message; }
    } else {
      for (const s of ['RAM purge ✓', 'Process freeze ✓', 'Disk clean ✓', 'DNS/TCP tune ✓']) {
        await new Promise(r => setTimeout(r, 400)); L.textContent += '\n' + s;
      }
      L.textContent += '\n\n⚡ SYSTEM BOOSTED — FPS +18% stimato'; window.__fps = true;
    }
    $('#boostStatus').textContent = '[Status: BOOSTED ⚡]';
    refreshStats();
  });

  // ---------- Finestra Aspetto: testo + animazioni + GPU MAX ----------
  async function lookRun(logKey, fn, demoMsg){
    const log = document.querySelector(`[data-log="${logKey}"]`);
    log.textContent = '⏳ esecuzione…';
    if (isElectron) {
      try { log.textContent = mark(await fn()); }
      catch(e){ log.textContent = '✕ ' + e.message; }
    } else { await new Promise(r => setTimeout(r, 500)); log.textContent = demoMsg; }
    enforceHeaders();
    refreshStats();
  }
  $$('[data-lookprev]').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.lookprev;
    const map = {
      font: ['font', () => window.overclock.previewTune('font', sysMode), '👁 Demo: anteprima testo — ClearType nitido vs Standard, effetto immediato, admin non serve.'],
      appearance: ['appearance', () => window.overclock.tune('appearance-preview'), '👁 Demo: anteprima aspetto standard.'],
      gpumax: ['gpumax', () => window.overclock.tune('gpumax-preview', { process: ($('#gpuMaxProc') || {}).value ? $('#gpuMaxProc').value.trim() : '' }), '👁 Demo: anteprima GPU MAX — GameDVR off, HAGS, MPO off, preferenza alte prestazioni.'],
      cpumax: ['cpumax', () => window.overclock.tune('cpumax-preview'), '👁 Demo: anteprima CPU MAX — piano Prestazioni elevate + scheduler giochi.'],
      fpsmax: ['fpsmax', () => window.overclock.tune('fpsmax-preview', { process: ($('#fpsProc') || {}).value ? $('#fpsProc').value.trim() : '' }), '👁 Demo: anteprima FPS MAX = GPU + CPU, solo più FPS.']
    };
    if (map[a]) lookRun(map[a][0], map[a][1], map[a][2]);
  }));
  $('#fontClear').addEventListener('click', () => lookRun('font', () => window.overclock.tune('font-mode', 'cleartype'), '✨ Demo: ClearType simulato.'));
  $('#fontStd').addEventListener('click', () => lookRun('font', () => window.overclock.tune('font-mode', 'standard'), '📝 Demo: Standard simulato.'));
  $('#fontOff').addEventListener('click', () => lookRun('font', () => window.overclock.tune('font-mode', 'off'), '⬜ Demo: smoothing OFF simulato.'));
  function lookOpt(logKey, opt, val, demoMsg){
    const log = document.querySelector(`[data-log="${logKey}"]`);
    log.textContent = '⏳ esecuzione…';
    if (isElectron) window.overclock.tune('look-option', { opt, val }).then(r => { log.textContent = mark(r); }).catch(e => { log.textContent = '✕ ' + e.message; });
    else log.textContent = demoMsg;
    enforceHeaders();
  }
  $('#transOn').addEventListener('click', () => lookOpt('lookopts', 'transparency', true, '🪟 Demo: trasparenza ON simulata.'));
  $('#transOff').addEventListener('click', () => lookOpt('lookopts', 'transparency', false, '🪟 Demo: trasparenza OFF simulata (più FPS).'));
  $('#animOn').addEventListener('click', () => lookOpt('lookopts', 'animations', true, '✨ Demo: animazioni ON simulate.'));
  $('#animOff').addEventListener('click', () => lookOpt('lookopts', 'animations', false, '✨ Demo: animazioni OFF simulate (più FPS).'));
  $('#menuFast').addEventListener('click', () => lookOpt('lookopts2', 'menudelay', 0, '⚡ Demo: menu istantanei simulati.'));
  $('#menuNorm').addEventListener('click', () => lookOpt('lookopts2', 'menudelay', 400, '🕐 Demo: menu normali simulati.'));
  $('#themeDark').addEventListener('click', () => lookOpt('lookopts2', 'theme', 'dark', '🌙 Demo: tema scuro simulato.'));
  $('#themeLight').addEventListener('click', () => lookOpt('lookopts2', 'theme', 'light', '☀️ Demo: tema chiaro simulato.'));
  $('#appearanceBtn').addEventListener('click', () => {
    if (isElectron && !window.confirm('Rimettere trasparenza, animazioni, effetti e testo come Windows standard?')) return;
    lookRun('appearance', () => window.overclock.tune('appearance-restore'), '↩ Demo: aspetto standard simulato.');
  });
  $('#gpuMaxBtn').addEventListener('click', () => {
    if (isElectron && !window.confirm('Applicare i massimi tweak GPU? Le chiavi di sistema (HAGS/MPO/throttling) richiedono admin e RIAVVIO del PC. Le altre app restano intatte.')) return;
    lookRun('gpumax', () => window.overclock.tune('gpu-max', { process: $('#gpuMaxProc').value.trim() }), '🎨 Demo: GPU MAX simulato.');
  });
  $('#gpuMaxRestore').addEventListener('click', () => lookRun('gpumax', () => window.overclock.tune('gpu-max-restore', null), '↩ Demo: GPU ripristinata.'));
  $('#cpuMaxBtn').addEventListener('click', () => {
    if (isElectron && !window.confirm('Applicare CPU MAX? Piano Prestazioni elevate subito; scheduler giochi richiede admin + riavvio. Le altre app restano intatte.')) return;
    lookRun('cpumax', () => window.overclock.tune('cpu-max'), '🧠 Demo: CPU MAX simulato.');
  });
  $('#cpuMaxRestore').addEventListener('click', () => lookRun('cpumax', () => window.overclock.tune('cpu-max-restore', null), '↩ Demo: CPU ripristinata.'));
  $('#fpsMaxBtn').addEventListener('click', () => {
    if (isElectron && !window.confirm('Applicare FPS MAX (GPU + CPU)? Unico obiettivo: più FPS. Chiavi di sistema = admin + riavvio. Le altre app restano intatte.')) return;
    lookRun('fpsmax', () => window.overclock.tune('fps-max', { process: $('#fpsProc').value.trim() }), '🚀 Demo: FPS MAX simulato.');
  });
  $('#fpsMaxRestore').addEventListener('click', () => lookRun('fpsmax', () => window.overclock.tune('fps-max-restore', null), '↩ Demo: FPS MAX ripristinato.'));
  async function loadLook(){
    if (!isElectron) { const f = $('#fpsVendor'); if (f) f.textContent = 'demo browser'; return; }
    try {
      const info = await window.overclock.tune('gpu-info');
      $('#gpuMaxVendor').textContent = '· scheda ' + String(info.vendor || '?').toUpperCase();
      const f = $('#fpsVendor'); if (f) f.textContent = '· scheda ' + String(info.vendor || '?').toUpperCase();
    } catch {}
  }

  // ---------- Game boost ----------
  async function loadGames(){
    // BUGFIX v1.1: prima caricava solo via fetch (fallisce in Electron file://) e mostrava 2 giochi.
    // Ora: IPC reale -> fetch -> fallback. Tutti i 35 preset sempre visibili.
    try {
      if (isElectron && window.overclock.gameList) {
        PRESETS = await window.overclock.gameList();
      } else throw 0;
    } catch {
      try {
        const r = await fetch('../modules/games-presets.json');
        PRESETS = await r.json();
      } catch {
        PRESETS = [{ id: 'cs2', name: 'Counter-Strike 2 (CS2)', genre: 'Shooter', process: 'cs2' }, { id: 'cyberpunk', name: 'Cyberpunk 2077', genre: 'RPG', process: 'Cyberpunk2077' }];
      }
    }
    renderGames('');
  }
  function renderGames(q){
    const box = $('#games'); box.innerHTML = '';
    PRESETS.filter(g => (g.name + g.genre).toLowerCase().includes(q.toLowerCase())).forEach(g => {
      const b = document.createElement('button');
      b.className = 'g-item' + (selectedGame === g.id ? ' active' : '');
      b.innerHTML = `${g.icon || '🎮'} ${g.name}<small>${g.genre} · ${g.process}</small>`;
      b.addEventListener('click', () => {
        selectedGame = g.id;
        $('#gName').textContent = (g.icon || '🎮') + ' ' + g.name;
        $('#gMeta').textContent = `${g.genre} · processo ${g.process}`;
        $('#gHint').textContent = 'Launch hint: ' + ((g.launchHint && (g.launchHint.default)) || 'priorità alta');
        $('#gEstimate').textContent = '📈 calcolo stima sul tuo PC…';
        $('#gWhy').textContent = '';
        if (isElectron) {
          window.overclock.gameEstimate(g.id).then(est => {
            if (selectedGame !== g.id) return; // hai già selezionato un altro gioco
            $('#gEstimate').textContent = est.title + '\n' + (est.modLine || '');
            $('#gWhy').textContent = est.tierWhy + '\n' + est.why.map(w => '• ' + w).join('\n') + '\n(' + est.note + ')';
          }).catch(() => { $('#gEstimate').textContent = ''; });
        } else {
          $('#gEstimate').textContent = "📈 Boost stimato: +15–25% FPS (demo — nell'app reale è calibrato sul tuo PC)";
          $('#gWhy').textContent = '• Priorità massima al processo di gioco\n• Affinity su tutti i core\n• Bloat OS disattivato durante il play';
        }
        renderGames($('#gameSearch').value);
      });
      box.appendChild(b);
    });
  }
  $('#gameSearch').addEventListener('input', e => renderGames(e.target.value));
  $('#boostGame').addEventListener('click', async () => {
    if (!selectedGame) { $('#gameLog').textContent = 'Seleziona prima un gioco dalla lista.'; return; }
    $('#gameLog').textContent = '⚡ boosting…';
    if (isElectron) {
      try { const r = await window.overclock.gameBoost(selectedGame); $('#gameLog').textContent = r.log.join('\n') + '\nHint: ' + r.launchHint; }
      catch(e){ $('#gameLog').textContent = '✕ ' + e.message; }
    } else {
      const g = PRESETS.find(x => x.id === selectedGame);
      await new Promise(r => setTimeout(r, 600));
      $('#gameLog').textContent = `▶ Boost attivo per ${g.name}\n· Priorità max ${$('#optPriority').checked ? 'ON' : 'off'}\n· Affinity core ${$('#optAffinity').checked ? 'ON' : 'off'}\n· Bloat OFF ${$('#optBloat').checked ? 'ON' : 'off'}\n· Proton/Gamemode/DXVK_ASYNC verificati (Linux) · Game Mode (macOS)\n⚡ FPS +23% stimato`;
      window.__fps = true;
    }
    $('#boostStatus').textContent = '[Status: GAME BOOSTED 🎮⚡]';
    refreshStats();
  });
  $('#modGame').addEventListener('click', async () => {
    if (!selectedGame) { $('#gameLog').textContent = 'Seleziona prima un gioco dalla lista.'; return; }
    $('#gameLog').textContent = '🧪 FPS MOD in corso… (config + core + app pesanti)';
    if (isElectron) {
      try {
        const r = await window.overclock.gameMod(selectedGame);
        $('#gameLog').textContent = r.log.join('\n');
        window.__fps = true;
      }
      catch(e){ $('#gameLog').textContent = '✕ ' + e.message; }
    } else {
      await new Promise(r => setTimeout(r, 800));
      $('#gameLog').textContent = `🧪 MOD simulato (demo browser)\n· Priorità High + core dedicati (no CPU0)\n· ✅ App in background intatte (nessun freeze)\n· Config gioco patchata con backup\n🧪 +10–15% FPS extra stimati`;
      window.__fps = true;
    }
    $('#boostStatus').textContent = '[Status: FPS MOD 🧪⚡]';
    refreshStats();
  });
  $('#stopGame').addEventListener('click', async () => {
    if (isElectron && selectedGame) await window.overclock.gameStop(selectedGame);
    window.__fps = false;
    $('#gameLog').textContent = '■ Boost disattivato, priorità ripristinate.';
    $('#boostStatus').textContent = '[Status: BOOSTED ⚡]';
    refreshStats();
  });

  // ---------- v1.3: Lancia gioco ottimizzato (mod temporanee a ogni avvio) ----------
  function fillLaunchSel(){
    const sel = $('#launchGameSel'); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '';
    PRESETS.forEach(g => {
      const o = document.createElement('option');
      o.value = g.id; o.textContent = `${g.icon || '🎮'} ${g.name}`;
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
    else if (selectedGame) sel.value = selectedGame;
  }
  function launchSelId(){
    const sel = $('#launchGameSel');
    return (sel && sel.value) || selectedGame;
  }
  function launchRun(fn, demoMsg, confirmMsg){
    const log = document.querySelector('[data-log="launch"]');
    const id = launchSelId();
    if (!id) { log.textContent = 'Seleziona prima un gioco (lista 🎮 o menu qui sopra).'; return; }
    if (confirmMsg && isElectron && !window.confirm(confirmMsg)) return;
    log.textContent = '⏳ esecuzione… (il lancio aspetta che il gioco parta, pazienta)';
    if (isElectron) fn(id).then(r => { log.textContent = mark(r); }).catch(e => { log.textContent = '✕ ' + e.message; });
    else log.textContent = demoMsg;
  }
  const _renderGames = renderGames;
  renderGames = function(q){ _renderGames(q); fillLaunchSel(); };
  const _lp = $('#launchPreviewBtn'); if (_lp) _lp.addEventListener('click', () => launchRun(id => window.overclock.launchPreview(id), '👁 Demo: mod temporanee + avvio Steam/exe + argomenti FPS + auto-ripristino alla chiusura.'));
  const _lb = $('#launchBtn'); if (_lb) _lb.addEventListener('click', () => launchRun(id => window.overclock.launchGame(id), '🚀 Demo: gioco lanciato e boostato (nell\u2019app reale parte davvero).', 'Lanciare il gioco con mod temporanee? All\u2019uscita ripristino tutto da solo.'));
  const _ls = $('#launchStopBtn'); if (_ls) _ls.addEventListener('click', () => launchRun(id => window.overclock.launchStop(id), '■ Demo: mod temporanee ripristinate.'));

  // ---------- v1.3: Ventole (profili + % + reset automatico) ----------
  function fanRun(logKey, fn, demoMsg, confirmMsg){
    const log = document.querySelector(`[data-log="${logKey}"]`);
    if (confirmMsg && isElectron && !window.confirm(confirmMsg)) return;
    log.textContent = '⏳ esecuzione…';
    if (isElectron) fn().then(r => { log.textContent = mark(r); }).catch(e => { log.textContent = '✕ ' + e.message; });
    else log.textContent = demoMsg;
  }
  const _fs = $('#fanStatusBtn'); if (_fs) _fs.addEventListener('click', () => fanRun('fanstatus', () => window.overclock.fanStatus(), '🌀 Demo: policy attivo · 58°C · vendor LEGION · snapshot salvato.'));
  const _fq = $('#fanQuiet'); if (_fq) _fq.addEventListener('click', () => fanRun('fanmode', () => window.overclock.fanSet('quiet'), '🔇 Demo: profilo silenzioso applicato.', 'Ventole in SILENZIOSA? Meno rumore, qualche FPS in meno.'));
  const _fb = $('#fanBalanced'); if (_fb) _fb.addEventListener('click', () => fanRun('fanmode', () => window.overclock.fanSet('balanced'), '⚖️ Demo: profilo bilanciato applicato.'));
  const _fm = $('#fanMax'); if (_fm) _fm.addEventListener('click', () => fanRun('fanmode', () => window.overclock.fanSet('max'), '🌪️ Demo: ventole al massimo (più rumore, CPU mai throttlata).', 'Ventole al MASSIMO? Più rumore, più FPS stabili.'));
  const _fpq = $('#fanPreviewQuiet'); if (_fpq) _fpq.addEventListener('click', () => fanRun('fanmode', () => window.overclock.fanPreview('quiet'), '👁 Demo: anteprima silenziosa — policy passiva + CPU 85%.'));
  const _pct = $('#fanPct'), _pctVal = $('#fanPctVal');
  if (_pct && _pctVal) _pct.addEventListener('input', () => { _pctVal.textContent = _pct.value + '%'; });
  const _fpc = $('#fanPreviewCustom'); if (_fpc) _fpc.addEventListener('click', () => fanRun('fancustom', () => window.overclock.fanPreview('custom', (_pct || {}).value || 70), '👁 Demo: anteprima % manuale.'));
  const _fac = $('#fanApplyCustom'); if (_fac) _fac.addEventListener('click', () => fanRun('fancustom', () => window.overclock.fanSet('custom', (_pct || {}).value || 70), '🎚️ Demo: velocità manuale applicata.', 'Applicare la velocità manuale alle ventole?'));
  const _fr = $('#fanResetBtn'); if (_fr) _fr.addEventListener('click', () => fanRun('fanreset', () => window.overclock.fanReset(), '↩ Demo: ventole in automatico.', 'Rimettere le ventole in AUTOMATICO (come da fabbrica)?'));
  const _fgm = $('#fanGaming'); if (_fgm) _fgm.addEventListener('click', () => fanRun('fanmode', () => window.overclock.fanSet('gaming'), '🎮 Demo: profilo gaming applicato (CPU sveglia, ventole presenti).'));
  const _fvb = $('#fanVendorBtn'); if (_fvb) _fvb.addEventListener('click', () => fanRun('fanstatus', () => window.overclock.fanVendor(), '🖥️ Demo: qui si aprirebbe FanControl / l\u2019app del produttore.'));

  // ---------- v1.4: NVIDIA MAX ----------
  function nvPaint(g){
    const box = $('#nvStats');
    if (!g || !g.available) { if (box) box.innerHTML = '<span class="mut">Scheda NVIDIA non rilevata: ' + ((g && g.reason) || 'nvidia-smi non trovato') + '</span>'; return; }
    const chip = (label, val) => `<span class="stat"><b>${val}</b><small>${label}</small></span>`;
    const nn = v => (v === null || v === undefined) ? 'n/d' : v;
    if (box) box.innerHTML = [
      chip('scheda', String(g.name || '—').replace(/NVIDIA GeForce /i, '')),
      chip('temp', nn(g.tempC) === 'n/d' ? 'n/d' : g.tempC + '°C'),
      chip('ventola', nn(g.fanPct) === 'n/d' ? 'n/d' : g.fanPct + '%'),
      chip('clock', nn(g.clockMHz) === 'n/d' ? 'n/d' : Math.round(g.clockMHz) + ' MHz'),
      chip('power limit', nn(g.powerLimitW) === 'n/d' ? 'n/d' : Math.round(g.powerLimitW) + ' W'),
      chip('utilizzo', nn(g.utilPct) === 'n/d' ? 'n/d' : g.utilPct + '%')
    ].join('');
    const n = $('#nvName'); if (n) n.textContent = '· ' + (g.name || 'NVIDIA');
    const b = $('#nvBadge'); if (b) b.textContent = 'driver ' + (g.driver || '?');
  }
  function nvRun(logKey, fn, demoMsg, confirmMsg){
    const log = document.querySelector(`[data-log="${logKey}"]`);
    if (!log) return;
    if (confirmMsg && isElectron && !window.confirm(confirmMsg)) return;
    log.textContent = '⏳ esecuzione…';
    if (isElectron) fn().then(r => { log.textContent = mark(r); if (r && r.gpu) nvPaint(r.gpu); refreshStats(); })
      .catch(e => { log.textContent = '✕ ' + e.message; });
    else log.textContent = demoMsg;
  }
  const _nvs = $('#nvStatusBtn'); if (_nvs) _nvs.addEventListener('click', () => nvRun('nvstatus', () => window.overclock.nvidia('status'), '🎮 Demo: RTX 4060 · 61°C · ventola 42% · power limit 90/115 W · clock 2640 MHz.'));
  const _nva = $('#nvApplyBtn'); if (_nva) _nva.addEventListener('click', () => nvRun('nvstatus', () => window.overclock.nvidia('apply', { lockClocks: true }), '🎮 Demo: power limit al massimo + clock bloccato + persistence + PowerMizer su massime prestazioni.', 'Spremere la GPU? Alzo il power limit al massimo e blocco il clock (serve admin). Tutto reversibile con "↩ Reset NVIDIA".'));
  const _nvg = $('#nvGuideBtn'); if (_nvg) _nvg.addEventListener('click', () => nvRun('nvguide', () => window.overclock.nvidia('guide'), '📋 Demo: 5 valori del pannello NVIDIA — prestazioni massime, low latency, VSync off, filtro 16x, DLSS qualità.'));
  const _nvp = $('#nvPanelBtn'); if (_nvp) _nvp.addEventListener('click', () => nvRun('nvguide', () => window.overclock.nvidia('panel'), '🖥️ Demo: qui si aprirebbe il pannello NVIDIA.', 'Aprire il pannello di controllo NVIDIA?'));
  const _nvr = $('#nvResetBtn'); if (_nvr) _nvr.addEventListener('click', () => nvRun('nvreset', () => window.overclock.nvidia('reset'), '↩ Demo: NVIDIA riportata ai valori di fabbrica.', 'Rimettere la GPU ai valori di fabbrica (power limit, clock, PowerMizer)?'));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.goto;
    $$('.side[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === v));
    $$('.view').forEach(x => x.classList.remove('active'));
    const t = $('#view-' + v); if (t) t.classList.add('active');
  }));
  $$('.side[data-view]').forEach(b => b.addEventListener('click', () => {
    if (!isElectron) return;
    if (b.dataset.view === 'fans') fanRun('fanstatus', () => window.overclock.fanStatus(), '');
    if (b.dataset.view === 'nvidia') window.overclock.nvidia('status').then(r => nvPaint(r && r.gpu)).catch(() => {});
  }));
  const _av = $('#appVersion');
  if (_av) _av.textContent = 'v' + ((isElectron && window.overclock.version) || '1.4.0') + ' · FPS BEAST+';

  // ---------- Ollama badge ----------
  async function ollamaPing(){
    try {
      const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
      const on = r.ok;
      $('#ollamaBadge').textContent = on ? '● OLLAMA ONLINE' : '○ OLLAMA OFFLINE';
      $('#ollamaBadge').style.color = on ? '#39ff88' : '#9aa3c0';
      $('#ollamaState').textContent = on ? 'online ✓ (locale, privato)' : 'offline — avvia `ollama serve`';
    } catch {
      $('#ollamaBadge').textContent = '○ OLLAMA OFFLINE';
      $('#ollamaState').textContent = 'offline — avvia `ollama serve`';
    }
  }

  // ---------- Manutenzione v1.2: salute + reset totale + disinstallazione ----------
  function maintRun(logKey, fn, demoMsg, confirmMsg){
    const log = document.querySelector(`[data-log="${logKey}"]`);
    if (confirmMsg && isElectron && !window.confirm(confirmMsg)) return;
    log.textContent = '⏳ esecuzione…';
    if (isElectron) {
      fn().then(r => { log.textContent = mark(r); enforceHeaders(); refreshStats(); })
        .catch(e => { log.textContent = '✕ ' + e.message; });
    } else { log.textContent = demoMsg; }
  }
  $('#healthBtn').addEventListener('click', () => maintRun('health', () => window.overclock.maint('health'), '🩺 Demo: OS ✓ · admin ✓ · snapshot 3 · boost ON · Ollama offline.'));
  $('#uninstallPreview').addEventListener('click', () => maintRun('uninstall', () => window.overclock.maint('uninstall-preview'), '👁 Demo: il reset ripristina sistema, GPU, CPU, aspetto, avvio, giochi e pulisce ~/.overclock.'));
  $('#fullResetBtn').addEventListener('click', () => maintRun('uninstall', () => window.overclock.maint('full-reset'), '🧹 Demo: tutto ripristinato + dati puliti.', 'Rimettere DAVVERO tutto come prima (sistema, GPU, CPU, aspetto, avvio, giochi) e cancellare i dati app?'));
  $('#uninstallInfoBtn').addEventListener('click', () => maintRun('uninstallApp', () => window.overclock.maint('uninstall-info'), '🔍 Demo: Uninstall.exe trovato in C:\\Program Files\\Overclock.'));
  $('#uninstallLaunchBtn').addEventListener('click', () => {
    if (!isElectron) { document.querySelector('[data-log="uninstallApp"]').textContent = '❌ Demo: qui partirebbe il disinstallatore.'; return; }
    if (!window.confirm('Fai prima il reset qui sopra! Avviare DAVVERO il disinstallatore e chiudere l\u2019app?')) return;
    const log = document.querySelector('[data-log="uninstallApp"]');
    log.textContent = '⏳ avvio disinstallatore…';
    window.overclock.uninstallApp().then(r => { log.textContent = mark(r); }).catch(e => { log.textContent = '✕ ' + e.message; });
  });
  async function loadHw(){
    const el = $('#pcBanner');
    if (!isElectron) { el.textContent = "🖥️ Demo browser: nell'app reale qui vedi il tuo PC e le stime FPS sono calibrate su di esso."; return; }
    try {
      const h = await window.overclock.hwProfile();
      const cpu = String(h.cpu || '').replace(/\(R\)|\(TM\)|@.*/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
      const gpu = String((h.gpus && h.gpus[0]) || 'GPU n/d').slice(0, 38);
      el.textContent = `🖥️ ${cpu} · ${h.cores}C/${h.threads}T · ${h.ramGB}GB RAM · ${gpu} — fascia ${String(h.tier).toUpperCase()} → stime FPS calibrate su questo PC`;
    } catch { el.textContent = '🖥️ PC non rilevato: stime FPS generiche.'; }
  }
  // ---------- v1.4: avvio con vetro che si incrina e si frantuma ----------
  (function bootShatter(){
    const bootEl = document.getElementById('boot');
    const bootSteps = document.getElementById('bootSteps');
    const shardsBox = document.getElementById('shards');
    const steps = ['caricamento moduli…', 'rilevamento GPU e CPU…', 'lettura ventole e sensori…', 'NVIDIA MAX pronto…', 'pronto ⚡'];
    if (bootSteps) steps.forEach((s, i) => setTimeout(() => { if (bootSteps) bootSteps.textContent = s; }, 210 + i * 250));

    // Pezzi di vetro: spicchi irregolari che partono dal punto d'impatto.
    if (shardsBox) {
      const N = 18, cx = 50, cy = 46;
      const pt = (a, r) => `${(cx + Math.cos(a) * r).toFixed(2)}% ${(cy + Math.sin(a) * r).toFixed(2)}%`;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2;
        const a1 = ((i + 1) / N) * Math.PI * 2;
        const mid = (a0 + a1) / 2;
        const R = 155;
        const s = document.createElement('i');
        s.style.clipPath = 'polygon(' + [`${cx}% ${cy}%`, pt(a0, R), pt(mid, R * (0.52 + Math.random() * 0.3)), pt(a1, R)].join(',') + ')';
        s.style.setProperty('--dx', (Math.cos(mid) * (55 + Math.random() * 35)).toFixed(1) + 'vw');
        s.style.setProperty('--dy', (Math.sin(mid) * (55 + Math.random() * 35)).toFixed(1) + 'vh');
        s.style.setProperty('--rot', ((Math.random() - 0.5) * 95).toFixed(1) + 'deg');
        s.style.animationDelay = (Math.random() * 0.06).toFixed(2) + 's';
        shardsBox.appendChild(s);
      }
    }

    const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let done = false;
    const breakGlass = () => {
      if (!bootEl || done) return;
      done = true;
      bootEl.classList.add('breaking');
      document.body.classList.add('booted');
      setTimeout(() => bootEl.classList.add('hide'), reduce ? 80 : 780);
      setTimeout(() => bootEl.remove(), reduce ? 400 : 1700);
    };
    if (bootEl) bootEl.addEventListener('click', breakGlass);
    setTimeout(breakGlass, reduce ? 450 : 1650);
  })();
  initEditor(); refreshStats(); loadGames(); ollamaPing(); loadTuning(); loadLook(); syncModeChips(); freezeHeaders(); loadHw();
  setInterval(refreshStats, 5000); setInterval(ollamaPing, 10000);
})();
