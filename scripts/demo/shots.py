# Captures d'écran de Cap en local, après scripts/demo/seed.mjs.
# Usage : python3 scripts/demo/shots.py   (paquet playwright requis). Les liens de connexion sont fabriqués via le compte technique.
import asyncio, json, os, shutil, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright
URL = os.environ.get('BASE', 'http://localhost:8788/')
OUT = os.path.join(HERE, 'shots') + '/'
os.makedirs(OUT, exist_ok=True)
CHROME = shutil.which('google-chrome') or shutil.which('chromium') or None
PASSWORD = os.environ.get('ADMIN_PASSWORD', 'test-admin')

class Api:
    def __init__(self): self.cookie = ''
    def call(self, path, method='GET', body=None):
        req = urllib.request.Request(URL.rstrip('/') + '/api' + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={'content-type': 'application/json', 'cookie': self.cookie, 'origin': URL.rstrip('/')})
        with urllib.request.urlopen(req) as r:
            sc = r.headers.get('set-cookie')
            if sc: self.cookie = sc.split(';')[0]
            return json.loads(r.read() or b'null')

async def main():
    api = Api(); api.call('/auth/admin', 'POST', {'password': PASSWORD})
    people = {p['name']: p['id'] for p in api.call('/admin/people')}
    def link(name): return api.call(f"/admin/people/{people[name]}/link", 'POST', {'send': False})['url']
    projects = api.call('/projects?scope=all')
    byTitle = {p['title']: p['id'] for p in projects}
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME) if CHROME else await p.chromium.launch()
        errs = []
        async def shot(name, who, hash_, wait=1200, mobile=False):
            ctx = await b.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900}, device_scale_factor=2 if mobile else 1.5)
            pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(f'{name}: {e}'))
            if who:
                await pg.goto(link(who)); await pg.wait_for_timeout(900)
            await pg.goto(URL + hash_); await pg.wait_for_timeout(wait)
            await pg.screenshot(path=OUT + f'{name}.png', full_page=True)
            await ctx.close()
        await shot('connexion', None, '#/')
        await shot('mon-espace-referent', 'Lokmann Hamidi', '#/')
        await shot('a-valider', 'Lokmann Hamidi', '#/a-valider')
        await shot('projet-a-valider', 'Lokmann Hamidi', f"#/projet/{byTitle['Petit-déjeuner solidaire de rentrée']}")
        await shot('nouveau-simple', 'Rayhane Sahli', '#/nouveau/simple')
        await shot('nouveau-complet', 'Rayhane Sahli', '#/nouveau/complet')
        await shot('projet-valide', 'Rayhane Sahli', f"#/projet/{byTitle['Séance de tutorat PASS : biochimie']}")
        await shot('projet-conference', 'Ismaïl Touré', f"#/projet/{byTitle['Conférence : éthique et fin de vie']}")
        await shot('calendrier', 'Ismaïl Touré', '#/calendrier')
        await shot('tableau-de-bord', 'Ismaïl Touré', '#/tableau')
        await shot('organigramme', 'Sofia Haddad', '#/organigramme')
        await shot('admin-personnes', 'Sofia Haddad', '#/admin/personnes')
        await shot('admin-reglages', 'Sofia Haddad', '#/admin/reglages')
        await shot('mobile-espace', 'Rayhane Sahli', '#/', mobile=True)
        await shot('mobile-nouveau', 'Rayhane Sahli', '#/nouveau/simple', mobile=True)
        await b.close()
        print('\n'.join(errs) if errs else 'Aucune erreur JavaScript.')
asyncio.run(main())
