// nvprofile.js — v1.4.1: applica DAVVERO le impostazioni 3D globali del pannello NVIDIA.
//
// Come funziona (niente magia, niente file di driver modificati a mano):
//   • Il pannello NVIDIA salva queste opzioni nel database dei profili del driver.
//   • L'unico modo ufficiale per scriverle è NVAPI DRS (NvAPI_DRS_SetSetting +
//     NvAPI_DRS_SaveSettings) sul profilo BASE, cioè quello globale.
//   • Qui carichiamo nvapi64.dll, apriamo una sessione DRS, leggiamo i valori
//     attuali (snapshot), scriviamo i nostri e RILEGGIAMO per verificare.
//   • Se una impostazione non esiste su quel driver, lo diciamo: nessun danno.
//   • "Ripristina profilo NVIDIA" rimette i valori letti prima (o li elimina se
//     prima non c'erano).
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const persist = require('./persist');

// Impostazioni del profilo FPS. id = ID DRS, name = nome ufficiale NVIDIA
// (usato per risolverlo se l'ID cambia nei driver nuovi).
// value: 0/1 ecc. secondo la scala NVIDIA. manual: true = non scrivibile via API.
const SETTINGS = [
  { key: 'aa_mode', name: 'Antialiasing - Mode', id: 0x107EFC5B, value: 0, human: 'Anti-aliasing - Modalità', want: 'Controllo applicazione' },
  { key: 'aa_method', name: 'Antialiasing - Setting', id: 0x10D773D2, value: 0, human: 'Anti-aliasing - Impostazione', want: 'Controllo applicazione' },
  { key: 'aa_gamma', name: 'Antialiasing - Gamma correction', id: 0x107D639D, value: 1, human: 'Anti-aliasing - Correzione gamma', want: 'Attivata' },
  { key: 'aa_transp', name: 'Antialiasing - Transparency Supersampling', id: 0x10D48A85, value: 0, human: 'Anti-aliasing - Trasparenza', want: 'Disattivata' },
  { key: 'fxaa', name: 'Enable FXAA', id: 276089202, value: 0, human: 'Anti-aliasing - FXAA', want: 'Disattivata' },
  { key: 'aniso', name: 'Anisotropic filtering setting', id: 270426537, value: 1, human: 'Filtro anisotropico', want: 'Controllo applicazione' },
  { key: 'aniso_mode', name: 'Anisotropic filtering mode', id: 282245910, value: 0, human: 'Filtro anisotropico - Modalità', want: 'Controllo applicazione' },
  { key: 'lod_bias', name: 'Texture filtering - Negative LOD bias', id: 1686376, value: 1, human: 'Filtro texture - Differenza LOD bias', want: 'Con attivazione blocco' },
  { key: 'aniso_opt', name: 'Texture filtering - Anisotropic filter optimization', id: 8703344, value: 1, human: 'Filtro texture - Ottimizzazione anisotropica', want: 'Attivata' },
  { key: 'trilin', name: 'Texture filtering - Trilinear optimization', id: 3066610, value: 1, human: 'Filtro texture - Ottimizzazione trilinea', want: 'Attivata' },
  // ATTENZIONE alla scala NVIDIA: Qualità alta=0xfffffff6, Qualità=0, Prestazioni=10, Prestazioni elevate=20.
  { key: 'quality', name: 'Texture filtering - Quality', id: 13510289, value: 0, human: 'Filtro texture - Qualità', want: 'Qualità' },
  { key: 'frl', name: 'Frame Rate Limiter', id: 277041154, value: 0, human: 'Frequenza fotogrammi massima', want: 'Disattivata' },
  { key: 'bg_frl', name: 'Background Application Max Frame Rate', id: 277041157, value: 0, human: 'Frequenza massima in background', want: 'Disattivata' },
  { key: 'pwr', name: 'Power management mode', id: 274197361, value: 1, human: 'Gestione dell\u2019alimentazione', want: 'Prestazioni massime preferite' },
  { key: 'lowlat', name: 'Low Latency Mode', id: 0x10835002, value: 0, human: 'Modalità a bassa latenza', want: 'Disattivata' },
  { key: 'mfaa', name: 'Enable sample interleaving (MFAA)', id: 10011052, value: 0, human: 'Multi-Frame Sampled AA (MFAA)', want: 'Disattivata' },
  { key: 'ao', name: 'Ambient Occlusion', id: 6714153, value: 0, human: 'Occlusione ambientale', want: 'Disattivata' },
  { key: 'threaded', name: 'Threaded optimization', id: 549528094, value: 1, human: 'Ottimizzazione threaded', want: 'Attivata' },
  { key: 'vsync', name: 'Vertical Sync', id: 11041231, value: 0, human: 'Sincronizzazione verticale', want: 'Usa impostazione applicazione' }
];

// Voci che il driver non espone in modo affidabile via API: restano in checklist.
const MANUAL = [
  'Pre-rendering fotogrammi VR: usa impostazione 3D globale',
  'GPU di rendering OpenGL: Selezione automatica',
  'Processore CUDA - GPU: Tutte',
  'Ridimensionamento immagine: Disattivato',
  'Virtual Reality - Super Resolution: Disattivata'
];

const CS_SOURCE = [
  'using System;',
  'using System.IO;',
  'using System.Runtime.InteropServices;',
  'using System.Text;',
  '',
  'public static class OcNvDrs',
  '{',
  '    [StructLayout(LayoutKind.Sequential, Pack = 8, CharSet = CharSet.Unicode)]',
  '    public struct NvUnion',
  '    {',
  '        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 4100)]',
  '        public byte[] raw;',
  '    }',
  '',
  '    [StructLayout(LayoutKind.Sequential, Pack = 8, CharSet = CharSet.Unicode)]',
  '    public struct NvSetting',
  '    {',
  '        public uint version;',
  '        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 2048)]',
  '        public string settingName;',
  '        public uint settingId;',
  '        public int settingType;',
  '        public int settingLocation;',
  '        public uint isCurrentPredefined;',
  '        public uint isPredefinedValid;',
  '        public NvUnion predefinedValue;',
  '        public NvUnion currentValue;',
  '    }',
  '',
  '    [DllImport("kernel32.dll", CharSet = CharSet.Ansi)]',
  '    static extern IntPtr LoadLibrary(string name);',
  '    [DllImport("kernel32.dll", CharSet = CharSet.Ansi)]',
  '    static extern IntPtr GetProcAddress(IntPtr mod, string proc);',
  '',
  '    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr QiDel(uint id);',
  '    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int InitDel();',
  '    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int CreateDel(ref IntPtr s);',
  '    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SessDel(IntPtr s);',
  '    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int BaseDel(IntPtr s, ref IntPtr p);',
  '    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SetDel(IntPtr s, IntPtr p, ref NvSetting st, uint a, uint b);',
  '    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int GetDel(IntPtr s, IntPtr p, uint id, ref NvSetting st, ref uint c);',
  '    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int DelDel(IntPtr s, IntPtr p, uint id);',
  '    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int NameIdDel(StringBuilder name, ref uint id);',
  '    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int EnumIdsDel(IntPtr p, ref uint max);',
  '    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int NameFromIdDel(uint id, StringBuilder name);',
  '',
  '    static T Ptr<T>(QiDel qi, uint a, uint b) where T : class',
  '    {',
  '        IntPtr p = qi(a);',
  '        if (p == IntPtr.Zero && b != 0) p = qi(b);',
  '        if (p == IntPtr.Zero) return null;',
  '        return Marshal.GetDelegateForFunctionPointer(p, typeof(T)) as T;',
  '    }',
  '',
  '    static NvSetting NewSetting(uint ver, uint id)',
  '    {',
  '        var s = new NvSetting();',
  '        s.version = ver;',
  '        s.settingId = id;',
  '        s.settingName = "";',
  '        s.predefinedValue.raw = new byte[4100];',
  '        s.currentValue.raw = new byte[4100];',
  '        return s;',
  '    }',
  '',
  '    static string ReadU32(byte[] b)',
  '    {',
  '        return (b != null && b.Length >= 4) ? BitConverter.ToUInt32(b, 0).ToString() : "?";',
  '    }',
  '',
  '    public static string Run(string cmdPath)',
  '    {',
  '        var o = new StringBuilder();',
  '        IntPtr sess = IntPtr.Zero;',
  '        try',
  '        {',
  '            IntPtr lib = LoadLibrary("nvapi64.dll");',
  '            if (lib == IntPtr.Zero) return "ERR|nvapi64.dll non caricata (driver NVIDIA assente?)";',
  '            IntPtr qp = GetProcAddress(lib, "nvapi_QueryInterface");',
  '            if (qp == IntPtr.Zero) return "ERR|nvapi_QueryInterface non trovata";',
  '            var qi = (QiDel)Marshal.GetDelegateForFunctionPointer(qp, typeof(QiDel));',
  '            var init = Ptr<InitDel>(qi, 0x0150E828, 0);',
  '            if (init == null) return "ERR|NvAPI_Initialize non disponibile";',
  '            int r = init();',
  '            if (r != 0) return "ERR|NvAPI_Initialize ha restituito " + r;',
  '            var create = Ptr<CreateDel>(qi, 0x0694D52E, 0);',
  '            var load = Ptr<SessDel>(qi, 0x375DBD6B, 0);',
  '            var save = Ptr<SessDel>(qi, 0xFCBC7E14, 0);',
  '            var destroy = Ptr<SessDel>(qi, 0xDAD9CFF8, 0);',
  '            var getBase = Ptr<BaseDel>(qi, 0xDA8466A0, 0);',
  '            var setF = Ptr<SetDel>(qi, 0x8A2CF5F5, 0x577DD202);',
  '            var getF = Ptr<GetDel>(qi, 0xEA99498D, 0x73BF8338);',
  '            var delF = Ptr<DelDel>(qi, 0xD20D29DF, 0xE4A26362);',
  '            var nameId = Ptr<NameIdDel>(qi, 0xCB7309CD, 0);',
  '            var enumIds = Ptr<EnumIdsDel>(qi, 0xE5DE48E5, 0xF020614A);',
  '            var nameFromId = Ptr<NameFromIdDel>(qi, 0x1EB13791, 0xD61CBE6E);',
  '            if (create == null || load == null || save == null || getBase == null || setF == null || getF == null)',
  '                return "ERR|funzioni DRS non disponibili nel driver";',
  '            r = create(ref sess);',
  '            if (r != 0) return "ERR|sessione DRS: " + r;',
  '            r = load(sess);',
  '            if (r != 0) o.AppendLine("ERR|load:" + r);',
  '            IntPtr prof = IntPtr.Zero;',
  '            r = getBase(sess, ref prof);',
  '            if (r != 0 || prof == IntPtr.Zero) return "ERR|profilo base non accessibile: " + r;',
  '            uint ver = (uint)(Marshal.SizeOf(typeof(NvSetting)) | (1 << 16));',
  '            var done = new System.Collections.Generic.List<uint>();',
  '            foreach (string raw in File.ReadAllLines(cmdPath))',
  '            {',
  '                string line = raw.Trim();',
  '                if (line.Length == 0 || line[0] == 35) continue;',
  '                string[] p = line.Split((char)124);',
  '                if (p.Length < 2) continue;',
  '                string op = p[0];',
  '                if (op == "NAMEID")',
  '                {',
  '                    uint given = 0;',
  '                    if (p.Length > 2) uint.TryParse(p[2], out given);',
  '                    if (nameId != null)',
  '                    {',
  '                        uint rid = 0;',
  '                        var sb = new StringBuilder(2048);',
  '                        sb.Append(p[1]);',
  '                        if (nameId(sb, ref rid) == 0 && rid != 0) { o.AppendLine("ID|" + p[1] + "|" + rid); continue; }',
  '                    }',
  '                    o.AppendLine("ID|" + p[1] + "|" + given);',
  '                    continue;',
  '                }',
  '                uint id = 0;',
  '                uint.TryParse(p[1], out id);',
  '                if (id == 0) { o.AppendLine("ERR|id-non-risolto|" + line); continue; }',
  '                if (op == "DEL")',
  '                {',
  '                    int dr = delF != null ? delF(sess, prof, id) : -1;',
  '                    o.AppendLine("DEL|" + id + "|" + dr);',
  '                    continue;',
  '                }',
  '                if (op == "GET")',
  '                {',
  '                    var gs = NewSetting(ver, id);',
  '                    uint c = 0;',
  '                    int gr = getF(sess, prof, id, ref gs, ref c);',
  '                    o.AppendLine("GET|" + id + "|" + (gr == 0 ? ReadU32(gs.currentValue.raw) : "err"));',
  '                    continue;',
  '                }',
  '                uint val = 0;',
  '                if (p.Length > 2) uint.TryParse(p[2], out val);',
  '                var ns = NewSetting(ver, id);',
  '                BitConverter.GetBytes(val).CopyTo(ns.currentValue.raw, 0);',
  '                int sr = setF(sess, prof, ref ns, 0, 0);',
  '                o.AppendLine("SET|" + id + "|" + sr + "|" + val);',
  '                done.Add(id);',
  '            }',
  '            o.AppendLine("SAVE|" + save(sess));',
  '            foreach (uint id in done)',
  '            {',
  '                var gs = NewSetting(ver, id);',
  '                uint c = 0;',
  '                int gr = getF(sess, prof, id, ref gs, ref c);',
  '                o.AppendLine("AFTER|" + id + "|" + (gr == 0 ? ReadU32(gs.currentValue.raw) : "err"));',
  '            }',
  '        }',
  '        catch (Exception e)',
  '        {',
  '            o.AppendLine("ERR|" + e.GetType().Name + ": " + e.Message);',
  '        }',
  '        finally',
  '        {',
  '            if (sess != IntPtr.Zero) { try { } catch { } }',
  '        }',
  '        return o.ToString();',
  '    }',
  '}'
].join('\r\n');

function psQuote(p) { return "'" + String(p).replace(/'/g, "''") + "'"; }

function runCmd(lines) {
  return new Promise((resolve) => {
    if (os.platform() !== 'win32') return resolve({ ok: false, out: 'Profilo NVIDIA: solo Windows.', lines: [] });
    const base = path.join(os.tmpdir(), 'oc-nvdrs-' + process.pid);
    const cmdFile = base + '.txt';
    const ps1 = base + '.ps1';
    const script = [
      "$ErrorActionPreference = 'Stop'",
      '$src = @"',
      CS_SOURCE,
      '"@',
      'try { Add-Type -TypeDefinition $src -Language CSharp -ErrorAction Stop } catch { "ERR|compilazione: " + $_.Exception.Message; exit 0 }',
      '$out = [OcNvDrs]::Run(' + psQuote(cmdFile) + ')',
      'Write-Output $out'
    ].join('\r\n');
    try {
      fs.writeFileSync(cmdFile, lines.join('\r\n'), 'utf8');
      fs.writeFileSync(ps1, script, 'utf8');
    } catch (e) {
      return resolve({ ok: false, out: 'Scrittura file temporanei fallita: ' + e.message, lines: [] });
    }
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], { timeout: 60000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const text = String(stdout || '') + '\n' + String(stderr || '');
      try { fs.unlinkSync(cmdFile); fs.unlinkSync(ps1); } catch { }
      const out = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(l => /^(ID|GET|SET|DEL|SAVE|AFTER|ERR)\|/.test(l));
      const fatal = out.find(l => l.startsWith('ERR|'));
      resolve({ ok: !fatal, out: fatal ? fatal.slice(4) : '', lines: out, raw: text.slice(0, 800) });
    });
  });
}

function checklist() {
  const rows = SETTINGS.map(s => `• ${s.human}: ${s.want}`);
  return `📋 PROFILO FPS — Gestisci le impostazioni 3D → Impostazioni globali\n\n` +
    rows.join('\n') +
    `\n${MANUAL.map(m => '• ' + m).join('\n')}\n\n` +
    `🎯 Il pulsante «⚡ Applica profilo NVIDIA» scrive queste voci nel profilo BASE del driver via NVAPI DRS e rilegge ogni valore per verificarti che sia davvero applicato.\n` +
    `↩ «Ripristina profilo NVIDIA» rimette i valori letti prima.\n` +
    `⚠️ Vsync, low latency e qualità texture hanno effetto dal prossimo avvio del gioco.`;
}

async function resolveIds() {
  const res = await runCmd(SETTINGS.map(s => `NAMEID|${s.name}|${s.id || 0}`));
  if (!res.ok) return { ok: false, out: res.out };
  const map = {};
  res.lines.forEach(l => {
    const p = l.split('|');
    if (p[0] === 'ID') map[p[1]] = parseInt(p[2], 10) || 0;
  });
  return { ok: true, map };
}

function fmtValue(s, v) {
  if (v === null || v === undefined) return 'assente (default driver)';
  const labels = {
    aa_mode: { 0: 'Controllo applicazione', 1: 'Migliora impostazione app', 2: 'Sostituisci impostazione app' },
    aniso: { 0: 'Off', 1: 'Controllo applicazione' },
    aniso_mode: { 0: 'Controllo applicazione', 1: 'Definito dall\u2019utente' },
    lod_bias: { 0: 'Consenti', 1: 'Blocco' },
    pwr: { 0: 'Adattiva', 1: 'Prestazioni massime preferite' },
    quality: { 0: 'Qualità', 10: 'Prestazioni', 20: 'Prestazioni elevate', 4294967286: 'Qualità alta' },
    vsync: { 0: 'Usa impostazione applicazione', 138504007: 'Forza off', 1196501518: 'Forza on' }
  };
  const m = labels[s.key];
  if (m && m[v] !== undefined) return `${m[v]} (${v})`;
  if (v === 0) return `Disattivata (0)`;
  if (v === 1) return `Attivata (1)`;
  return String(v);
}

async function status() {
  if (os.platform() !== 'win32') return { ok: false, out: 'Profilo NVIDIA: solo Windows.' };
  const ids = await resolveIds();
  if (!ids.ok) return { ok: false, out: `⚠️ NVAPI non disponibile: ${ids.out}\nUsa il pannello NVIDIA (📋 Guida) per applicare la lista a mano.` };
  const active = SETTINGS.filter(s => ids.map[s.name]);
  const res = await runCmd(active.map(s => `GET|${ids.map[s.name]}`));
  const byId = {};
  res.lines.forEach(l => { const p = l.split('|'); if (p[0] === 'GET') byId[p[1]] = p[2] === 'err' ? null : parseInt(p[2], 10); });
  const rows = active.map(s => {
    const v = byId[ids.map[s.name]];
    return `• ${s.human}: ${fmtValue(s, v)} ${v === s.value ? '✓' : '← atteso: ' + s.want}`;
  });
  const manual = MANUAL.map(m => `• ${m} (solo pannello)`);
  return {
    ok: true,
    out: `🎮 PROFILO 3D GLOBALE — sola lettura (non ho toccato nulla)\n\n${rows.join('\n')}\n\n${manual.join('\n')}`
  };
}

// maxPerf: la qualità texture passa da "Qualità" (0) a "Prestazioni elevate" (20).
// Su schede piccole è l'unica voce della lista che sposta davvero gli FPS.
async function apply(opts = {}) {
  const maxPerf = !!opts.maxPerf;
  const target = (s) => (maxPerf && s.key === 'quality') ? 20 : s.value;
  const want = (s) => (maxPerf && s.key === 'quality') ? 'Prestazioni elevate (più FPS)' : s.want;
  if (os.platform() !== 'win32') return { ok: false, out: 'Profilo NVIDIA: solo Windows.' };
  const ids = await resolveIds();
  if (!ids.ok) return { ok: false, out: `⚠️ NVAPI non disponibile: ${ids.out}` };
  const active = SETTINGS.filter(s => ids.map[s.name]);
  if (!active.length) return { ok: false, out: '⚠️ Nessuna impostazione risolta: driver NVIDIA non standard.' };

  // 1) snapshot dei valori attuali (per il reset)
  const cur = await runCmd(active.map(s => `GET|${ids.map[s.name]}`));
  const before = {};
  cur.lines.forEach(l => { const p = l.split('|'); if (p[0] === 'GET') before[p[1]] = p[2] === 'err' ? null : parseInt(p[2], 10); });
  const prevSnap = active.map(s => ({ key: s.key, name: s.name, id: ids.map[s.name], prev: before[ids.map[s.name]] }));

  // 2) scrittura
  const setRes = await runCmd(active.map(s => `SET|${ids.map[s.name]}|${target(s)}`));
  const setStatus = {};
  setRes.lines.forEach(l => { const p = l.split('|'); if (p[0] === 'SET') setStatus[p[1]] = parseInt(p[2], 10); });
  const saved = setRes.lines.find(l => l.startsWith('SAVE|'));
  const saveRes = saved ? parseInt(saved.split('|')[1], 10) : -1;
  const after = {};
  setRes.lines.forEach(l => { const p = l.split('|'); if (p[0] === 'AFTER') after[p[1]] = p[2] === 'err' ? null : parseInt(p[2], 10); });

  const okRows = [];
  const badRows = [];
  active.forEach(s => {
    const id = ids.map[s.name];
    const got = after[id];
    const bad = setStatus[id] !== 0 || got === null || got === undefined || got !== target(s);
    const row = `${bad ? '✕' : '✓'} ${s.human} → ${want(s)}${bad ? (setStatus[id] !== 0 ? ` (driver: codice ${setStatus[id]})` : ` (riletto: ${fmtValue(s, got)})`) : ''}`;
    (bad ? badRows : okRows).push(row);
  });

  if (okRows.length) persist.putSnap('nvprofile', { when: new Date().toISOString(), prev: prevSnap });
  persist.markActive('nvprofile');

  const head = okRows.length === active.length
    ? `🎮 PROFILO NVIDIA APPLICATO — ${okRows.length}/${active.length} impostazioni scritte nel profilo globale (base) del driver.`
    : `🎮 PROFILO NVIDIA APPLICATO IN PARTE — ${okRows.length}/${active.length} scritte.`;
  const tail = [
    '',
    saveRes === 0 ? '💾 Profilo salvato nel driver (SaveSettings OK).' : `⚠️ Salvataggio driver NON confermato (codice ${saveRes}): le modifiche potrebbero non restare dopo il riavvio.`,
    '🔄 Effetto: dai prossimi avvii dei giochi. Il pannello NVIDIA mostra gli stessi valori.',
    MANUAL.length ? `ℹ Non scriptabili (2 minuti nel pannello): ${MANUAL.join(' · ')}` : '',
    '↩ «Ripristina profilo NVIDIA» rimette i valori letti prima di applicare.'
  ].filter(Boolean).join('\n');

  return {
    ok: okRows.length > 0,
    applied: okRows.length,
    failed: badRows.length,
    out: `${head}\n\n${okRows.join('\n')}${badRows.length ? '\n' + badRows.join('\n') : ''}\n${tail}`
  };
}

async function reset() {
  const snap = persist.getSnap('nvprofile');
  if (!snap || !Array.isArray(snap.prev) || !snap.prev.length) {
    return { ok: false, out: 'ℹ Nessuno snapshot del profilo NVIDIA: non ho mai applicato il profilo, oppure è già stato ripristinato.' };
  }
  const cmds = snap.prev.map(p => (p.prev === null || p.prev === undefined) ? `DEL|${p.id}` : `SET|${p.id}|${p.prev}`);
  const res = await runCmd(cmds);
  const done = res.lines.filter(l => l.startsWith('SET|') || l.startsWith('DEL|'));
  const bad = done.filter(l => parseInt(l.split('|')[2], 10) !== 0);
  persist.putSnap('nvprofile', null);
  persist.markRestored();
  return {
    ok: bad.length === 0,
    out: `↩ PROFILO NVIDIA RIPRISTINATO — ${done.length - bad.length}/${snap.prev.length} voci rimesse come prima.\n` +
      (bad.length ? `⚠️ ${bad.length} voci non ripristinabili (driver: ${bad.slice(0, 3).join(' · ')}).\n` : '') +
      `ℹ Le altre impostazioni del pannello restano quelle che avevi.`
  };
}

module.exports = { apply, reset, status, checklist, SETTINGS, MANUAL, _runCmd: runCmd };
