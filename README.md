# OPAL ⇄ Zemax

Converts `.zmx` ↔ `.OPJ` (OPAL-PC) in the browser. Load the `.AGF` files from
`Documents\Zemax\Glasscat` once, then drop files. OPAL glasses not found in the catalogs go to a
companion `OPAL_<name>.AGF`; copy it into the Glasscat folder.

Centred sequential systems only.

```
npm install
npm run dev                 # local page
npm test
node scripts/cli.ts FILE…   # command line, same converter
```

Pushing to `main` deploys to GitHub Pages (Settings → Pages → Source: GitHub Actions).

OPJ format notes: [docs/OPJ_FORMAT.md](docs/OPJ_FORMAT.md).
