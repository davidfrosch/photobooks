Local development — CORS and ES modules

Why you see the CORS error

- Modern browsers block ES module imports when you open an HTML file directly from disk (file://). The browser treats the page as origin "null", and module scripts are blocked for security reasons.

Quick fixes (pick one):

1) Python (no install required on macOS usually)

```bash
# From the project root
python3 -m http.server 8000
# Then open http://localhost:8000 in your browser
```

2) Use http-server via npx (no global install)

```bash
# From the project root
npx http-server -c-1 . 8080
# Then open http://localhost:8080
```

3) npm script (if you prefer npm)

```bash
npm install
npm start
# opens at http://localhost:8080
```

Notes

- Using a local HTTP server serves files over the http:// protocol so ES modules and import maps load correctly.
- If you want me to start a local server in this environment and test the page, say so and I'll run it.
