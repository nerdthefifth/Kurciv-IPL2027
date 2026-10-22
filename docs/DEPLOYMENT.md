# Deployment

Kurciv is a **static web app**. The game engine runs in a Web Worker in the player's browser and careers are stored in that browser's IndexedDB, so there is no server, database or secret to configure. Any static host works.

**Live site:** <https://kurciv-ipl-2027.vercel.app/> (Vercel project `kurciv-ipl-2027`)

## Vercel (current hosting)

The repository is set up for Vercel with two files at the root.

`vercel.json`:

| Setting | Value | Why |
| --- | --- | --- |
| `installCommand` | `npm install` | Installs all workspaces |
| `buildCommand` | `npm run build` | Builds `apps/web` with Vite |
| `outputDirectory` | `apps/web/dist` | The static site |
| `rewrites` | everything → `/index.html` | Client-side routes such as `/c/<career>/match` load the app (real files are served first) |
| `headers` | long-lived cache for `/assets/*`, one week for `/models/*` | Built assets have content-hashed names |

`.vercelignore` keeps the upload small. It excludes `node_modules`, test output, the Cricsheet download cache (`/data/cache`, which includes a 127 MB zip, over Vercel's 100 MB per-file limit) and the source model files in the repository root. Entries are anchored with `/`. On Windows, an unanchored `Cricketers.glb` also matched the game's `apps/web/public/models/cricketers.glb`.

### Deploying from your machine

```bash
npx vercel login                                   # once
npx vercel deploy --prod --project kurciv-ipl-2027 # from the repository root
```

The first deploy of a new copy can use `--create-if-missing` to create the project. Vercel builds remotely; a production build takes about a minute.

### Deploying from GitHub

To deploy on every push instead, connect the repository in the Vercel dashboard (Project → Settings → Git). No extra configuration is needed, because the settings above come from `vercel.json`.

## Other static hosts

```bash
npm ci
npm run build    # → apps/web/dist
```

Serve `apps/web/dist` and rewrite unknown paths to `index.html` so client-side routes work, for example a Netlify `_redirects` file containing `/* /index.html 200`. The build must be served over HTTPS (or `localhost`) for IndexedDB and module workers to work in every browser.

## What players should know

- **Saves are per browser.** Clearing site data deletes careers. Use **Save & Settings → Export backup** to download a career file, and import it from the **Saves** screen to restore it on another device or browser.
- **Updates are safe for saves.** Save files carry a schema version and older careers are migrated on load (see [DATABASE.md](DATABASE.md)).
- **3D needs WebGL.** Without it, the match screen falls back to the 2D scoreboard with every control still available.

## Size

The app shell is about 0.6 MB of JavaScript and the engine worker about 2 MB, which includes the compact player database (all before gzip). The 3D view (three.js and the scene, about 0.65 MB, roughly 170 KB gzipped) and the 2 MB player model are only downloaded when a match is opened in 3D.
