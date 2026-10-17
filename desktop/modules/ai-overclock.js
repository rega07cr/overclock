const os = require('os');

async function callOllama(model, prompt, system) {
  // Usa fetch nativo di Node 18+. Se Ollama non gira, lancia errore catturato dal renderer.
  const res = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, system, stream: false })
  });
  if (!res.ok) throw new Error('Ollama HTTP ' + res.status);
  const data = await res.json();
  return data.response;
}

function localHeuristic(mode, kind, input) {
  // Fallback offline deterministico quando nessun modello è disponibile.
  if (kind === 'prompt') {
    return `🎯 ROLE: Agisci come senior expert.\n📌 OBIETTIVO: ${input.slice(0, 220)}\n🧠 CHAIN-OF-THOUGHT: 1) riformula il task 2) elenca vincoli 3) proponi 3 approcci 4) scegli il migliore 5) output con esempi.\n✅ FORMATO: risposta strutturata, criteri di accettazione, contro-esempi.\n⚠️ VINCOLI: cita assunzioni, chiedi chiarimenti se ambiguo.`;
  }
  if (mode === 'speed') return `// ⚡ SPEED BUFF — O(n) minimo, zero allocazioni extra\n${input}\n// → Suggerimento: sostituisci cicli annidati con Map/Set, memoizza, early-return.`;
  if (mode === 'sec') return `// 🛡️ SECURITY BUFF — validazione + tipi\n// TODO: valida ogni input esterno, evita eval/innerHTML, usa tipi strict.\n${input}`;
  return `// 🧠 PRO SENIOR BUFF — pattern puliti (SRP, pure functions, DI)\n// TODO: estrai funzioni pure, nomina intention-revealing, aggiungi test.\n${input}`;
}

const SYSTEMS = {
  speed: 'Sei un compilatore umano: riscrivi il codice per prestazioni massime, complessità O(1)/O(n), zero sprechi. Rispondi solo con codice + 3 bullet di cosa hai cambiato.',
  sec: 'Sei un security engineer: correggi bug, aggiungi type-checking rigoroso e validazione input. Rispondi solo con codice + lista vulnerabilità chiuse.',
  pro: 'Sei un principal engineer: riscrivi con i migliori pattern (SOLID, pure functions). Rispondi con codice + spiegazione senior breve.',
  prompt: 'Sei un prompt engineer: trasforma il prompt utente in un prompt ingegnerizzato con Role + Chain-of-Thought + formato + vincoli.'
};

async function aiBuff({ mode = 'speed', kind = 'code', input, model, cloudKey }) {
  if (!input || !input.trim()) throw new Error('Input vuoto');
  // 1) Prova Ollama locale
  try {
    const m = model || (kind === 'prompt' ? 'llama3' : 'codellama');
    const out = await callOllama(m, input, SYSTEMS[mode === 'pro' ? 'pro' : mode] || SYSTEMS.prompt);
    return { ok: true, engine: 'ollama:' + m, output: out };
  } catch (e) {
    // 2) Fallback euristico locale (privacy totale, funziona sempre)
    return { ok: true, engine: 'local-heuristic (ollama offline)', output: localHeuristic(mode, kind, input), offline: true };
  }
}

async function ollamaStatus() {
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { online: false };
    const d = await res.json();
    return { online: true, models: (d.models || []).map(m => m.name) };
  } catch { return { online: false }; }
}

module.exports = { aiBuff, ollamaStatus };
