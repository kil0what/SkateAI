# SkateAI

SkateAI is a front-end prototype for a figure skating jump judge assistant. The app uses MediaPipe Pose in the browser, overlays skeleton tracking on top of a video, and applies explainable heuristics to estimate jump families such as axel, toe, and edge jumps.

## Improvements in this iteration

- Modularized the one-file prototype into `index.html`, `styles.css`, and `app.js`.
- Added a professional control panel, live metrics, diagnostics, event timeline, and heuristic threshold sliders.
- Improved jump-state handling with explicit takeoff / flight / landing phases and richer event logging.
- Added a roadmap section to clarify the path from heuristic MVP to production-grade judging intelligence.

## Run locally

Because this is a static front-end prototype, you can launch it with any static file server.

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Important note

This version still uses heuristic rules, not a trained ML model. For real judging-grade reliability, the next step is collecting a labeled dataset and training a temporal classifier on pose sequences.
