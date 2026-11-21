# Timbre

A browser-based workbench for designing headphone and earphone EQ curves.

Drag a curve, hear it instantly, then export the profile to whatever actually applies EQ on
your machine.

> **Timbre is not a system-wide equalizer.** A browser can only process audio it owns. Timbre
> is a *design and preview* tool plus a *profile compiler*. The handoff is the product.

## Status

**M0 — Skeleton.** Playback, auto-preamp, a 5-band parametric EQ, and a live response graph.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

```bash
npm run build      # typecheck + production build
npm run typecheck  # types only
```

## What works today

- Local file playback (drag and drop, or **Open file**)
- Synthesised pink noise and a 20 Hz – 20 kHz sweep for auditioning
- 5 parametric bands: peak, low shelf, high shelf
- Drag a node on the graph to set frequency and gain
- Automatic preamp: offsets the largest boost so nothing clips
- Click-free bypass, level-matched against the preamp
- Live output peak meter

## Architecture

```
index.html
src/
  main.ts              wiring, transport, state
  style.css
  audio/
    dsp.ts             RBJ biquads, magnitude response, auto-preamp
    engine.ts          Web Audio graph, file + test-signal sources
  model/
    band.ts            Band model, defaults, formatting helpers
  ui/
    graph.ts           canvas response plot + pointer interaction
    bandList.ts        per-band controls
```

Signal flow:

```
input ──► preamp ──► band 0 ──► … ──► band 4 ──► eqGain ──┐
  └──────────────────────────────────────────► dryGain ──┴──► out ──► analyser ──► destination
```

Bypass crossfades `eqGain` against `dryGain` rather than tearing the chain down, so A/B
switching is click-free.

## Known gaps (by design, for now)

- Audio still runs through `BiquadFilterNode`. The cascade moves into an `AudioWorklet` in M1
  so that shelf coefficients match what gets exported (PRD TR-3 / risk R2).
- No persistence, import, export, measurement overlay, or solver yet — those are M2/M3.
- Desktop-first. Mobile works but the layout is tighter.

## Roadmap

| Milestone | Scope |
|---|---|
| M0 | Playback, preamp, 5 bands, graph ✅ |
| M1 | AudioWorklet cascade, per-channel, undo, gain-matched A/B |
| M2 | Profiles, `ParametricEQ.txt` import/export, Equalizer APO export |
| M3 | Measurement CSV overlay, target curves, auto-fit solver |
| M4 | Limiter, PWA, accessibility pass |

See [`PRD.md`](./PRD.md) for the full requirements.
