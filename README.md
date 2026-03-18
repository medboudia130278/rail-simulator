# Rail Simulator

Application React/Vite pour simuler l'usure, le meulage et les échéances de maintenance rail.

## Lancement local

Si `npm` est bloqué dans PowerShell, utilisez `npm.cmd` :

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npm.cmd" run dev
```

Sinon, dans un nouveau terminal :

```powershell
npm install
npm run dev
```

L'application démarre en général sur `http://localhost:5173`.

## Build de production

```powershell
& "C:\Program Files\nodejs\npm.cmd" run build
```

Le build statique est généré dans `dist/`.

## Partage à d'autres utilisateurs

La solution la plus simple est de déployer le contenu de `dist/` sur un hébergement statique :

- Vercel
- Netlify
- GitHub Pages
- Serveur interne

Les utilisateurs n'auront alors qu'à ouvrir une URL dans leur navigateur.

## Preview locale du build

```powershell
& "C:\Program Files\nodejs\npm.cmd" run preview
```
