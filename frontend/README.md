# Y2 Markets – frontend

Angular 22 app (standalone components, signals, new control flow).

```powershell
npm install
npm start          # http://localhost:4200, proxies /api and /socket.io to http://localhost:4000
npm run build      # production build → dist/client/browser
```

The backend (`../backend`) must be running. See the root README for the full guide.
Scenic backgrounds and the world map are generated SVGs: `node scripts/gen-scenes.mjs`, `node scripts/gen-worldmap.mjs`.
