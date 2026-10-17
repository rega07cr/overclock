import json, os, sys
fails = []
def check(path, needle=None):
    if not os.path.exists(path):
        fails.append(f"MISSING {path}"); return
    if needle:
        src = open(path, encoding='utf-8', errors='ignore').read()
        if needle not in src:
            fails.append(f"NEEDLE {needle!r} not in {path}")

check('index.html', 'Overclock Your PC')
check('index.html', 'Download Free Buff')
check('index.html', 'data-dl')
check('styles.css', '--neon')
check('app.js', 'userAgent')
check('desktop/main.js', 'BrowserWindow')
check('desktop/preload.js', 'overclock')
check('desktop/modules/system-booster.js', 'fullBuff')
check('desktop/modules/game-boost.js', 'applyGameBoost')
check('desktop/modules/ai-overclock.js', 'localhost:11434')
check('desktop/modules/tuning.js', 'osOverclock')
check('desktop/modules/tuning.js', 'gpuBoost')
check('desktop/main.js', 'tuning:run')
check('desktop/renderer/index.html', 'Overclock Sistema')
check('desktop/renderer/index.html', 'APPLY FREE BUFF')
check('desktop/renderer/renderer.js', 'monaco')
check('desktop/modules/games-presets.json')
games = json.load(open('desktop/modules/games-presets.json', encoding='utf-8'))
if len(games) < 30:
    fails.append(f"GAMES only {len(games)}, want >=30")
ids = {g['id'] for g in games}
for want in ['valorant','cs2','cyberpunk','lol','eldenring','bg3']:
    if want not in ids: fails.append(f"GAME preset missing: {want}")
print(f"games presets: {len(games)}")
if fails:
    print("FAIL:"); [print(" -", f) for f in fails]; sys.exit(1)
print("VERIFY OK — landing + 3 moduli + 20 preset presenti")
