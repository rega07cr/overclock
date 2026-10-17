# ⚡ OVERCLOCK — One App, Total Power

Il Free Buff definitivo per sviluppatori, gamer e power user. macOS · Windows · Linux.

## Struttura

```
index.html / styles.css / app.js      → landing page (sito ufficiale + download hub)
desktop/
  main.js / preload.js / package.json → app Electron
  modules/
    ai-overclock.js                   → Ollama locale + fallback euristico
    system-booster.js                 → RAM / processi / disco / rete per-OS
    game-boost.js + games-presets.json→ 20 preset + Proton/Gamemode/Game Mode
  renderer/
    index.html / app.css / renderer.js→ UI sidebar 3 moduli (funziona anche da browser!)
releases/                             → hub download (placeholder firmati in CI)
worker.js + sites-manifest.json       → deploy Cloudflare Sites
```

## Demo immediata (senza installare nulla)

```bash
py -m http.server 8080
# apri http://localhost:8080/  (landing)
# apri http://localhost:8080/desktop/renderer/  (app demo live nel browser)
```

L'app renderer funziona in due modi:
- **Browser demo**: euristiche locali simulate, Monaco via CDN.
- **Electron reale**: `npm install && npm start` in `desktop/` → API OS vere via IPC.

## App desktop reale

```bash
cd desktop
npm install
npm start                 # dev
npm run dist:win          # .exe NSIS + .msi + portable zip
npm run dist:mac          # .dmg universal
npm run dist:linux        # .AppImage + .deb + .tar.gz
```

## Ollama offline (privacy 100%)

```bash
ollama pull llama3 && ollama pull codellama
ollama serve
# l'app mostra ● OLLAMA ONLINE e usa i modelli locali
```

## Verifiche

- `py verify.py` — controlla che tutti i file, preset (20 giochi) e sezioni esistano.
