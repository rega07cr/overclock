# ⚡ OVERCLOCK — One App, Total Power

Il Free Buff definitivo per sviluppatori, gamer e power user. macOS · Windows · Linux.

**Creato da REGA · © 2026 REGA — Tutti i diritti riservati.**

## Cosa fa

- **💻 Code/AI Overclock** — Ollama locale (privacy 100%) + fallback euristico: Speed / Security / Pro + Prompt mode.
- **🚀 System Booster** — RAM flush, pulizia disco, DNS/TCP, GPU Boost (NVIDIA/AMD/Intel), Overclock OS per PC vecchi. Niente freeze: le app in background non vengono mai toccate.
- **🚀 FPS MAX BEAST (v1.3)** — GPU MAX + CPU MAX + extra in un click, unico obiettivo: più FPS (TdrDelay, Ultimate Performance, core parking OFF, UI leggera, RAM standby). Onesto: nessun software fa ×100 — qui spremi il massimo via software.
- **🎮 Lancia gioco ottimizzato (v1.3)** — card in FPS MAX: avvii il gioco dall'app, mod temporanee + argomenti FPS + priorità High, auto-ripristino alla chiusura.
- **🌀 Ventole (v1.3)** — sezione dedicata: profili silenziosa/bilanciata/massima + % manuale 10–100% + stato in sola lettura + reset automatico di fabbrica.
- **🔤 Aspetto esteso (v1.1)** — testo ClearType/Standard/OFF, trasparenza, animazioni, menu, tema scuro/chiaro, ognuno con anteprima leggibile.
- **🧹 Disinstallazione semplice (v1.2)** — sezione Impostazioni: reset totale (sistema, GPU, CPU, aspetto, avvio, giochi + pulizia ~/.overclock) + avvio Uninstall.exe; **🩺 Salute sistema** come extra.
  - **👁 Anteprima** prima di ogni modifica (mostra cosa cambierà, senza toccare nulla) + conferma per le azioni distruttive.
  - **↩ Ripristina** per ogni modulo + ripristino totale (snapshot salvati, valgono anche dopo il riavvio).
  - **3 livelli**: 🟢 Base (solo sicuro) / 🟡 Media (consigliata) / 🔴 Potente (tutto al massimo).
  - Intestazioni e testi delle schede non cambiano mai: si aggiorna solo il box di log.
- **🎮 Game Boost** — 35 preset (Roblox, CS2, GTA, Minecraft…), Proton/Gamemode/DXVK su Linux, Game Mode su macOS.

## Struttura

```
index.html / styles.css / app.js      → landing page (sito + download hub)
desktop/
  main.js / preload.js / package.json → app Electron
  modules/
    ai-overclock.js                   → Ollama locale + fallback euristico
    system-booster.js                 → RAM / processi / disco / rete (3 livelli + preview + restore)
    tuning.js                         → GPU boost + Overclock OS (3 livelli + preview + restore)
    game-boost.js + games-presets.json→ 35 preset + Proton/Gamemode/Game Mode
  renderer/
    index.html / app.css / renderer.js→ UI (funziona anche da browser come demo!)
releases/                             → build locali (ignorate da git; quelle ufficiali stanno nelle GitHub Releases)
.github/workflows/release.yml        → CI: compila Windows/macOS/Linux a ogni tag v*
```

## Demo immediata (senza installare nulla)

```bash
py -m http.server 8080
# apri http://localhost:8080/  (landing)
# apri http://localhost:8080/desktop/renderer/  (app demo live nel browser)
```

## App desktop reale

```bash
cd desktop
npm install
npm start                 # dev
npm run dist:win          # .exe NSIS + .msi + portable
npm run dist:mac          # .dmg
npm run dist:linux        # .AppImage + .deb + .tar.gz
```

## Ollama offline (privacy 100%)

```bash
ollama pull llama3 && ollama pull codellama
ollama serve
# l'app mostra ● OLLAMA ONLINE e usa i modelli locali
```

## Verifiche

- `py verify.py` — controlla file, preset (≥30 giochi) e sezioni.
- Syntax check JS (senza node installato, usa l'Electron bundlato):
  `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe --check modules/system-booster.js`

## Pubblicare su GitHub (repo + sito + download)

1. Crea la repo su github.com (es. `overclock`), senza README.
2. Dal terminale nella cartella del progetto:
   ```
   git remote add origin https://github.com/TUO-NOME/overclock.git
   git push -u origin master
   ```
3. In `app.js` scrivi `const GITHUB_REPO = 'TUO-NOME/overclock'` → i pulsanti Download punteranno alle Releases.
4. Crea una release: `git tag v1.3.0 && git push origin v1.3.0` → la CI compila Windows/macOS/Linux e allega gli exe.
5. **Sito online**: Settings → Pages → Deploy from branch → `master` → Save. Il sito sarà su `https://TUO-NOME.github.io/overclock/`.
6. `.exe` e build pesanti **non** vanno nel repo (già in `.gitignore`): vivono solo nelle Releases.
