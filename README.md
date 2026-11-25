# Timbre

A browser-based workbench for designing headphone and earphone EQ curves.

Drag a curve, hear it instantly, then export the profile to whatever actually applies EQ on
your machine.

> **Timbre is not a system-wide equalizer.** A browser can only process audio it owns. Timbre
> is a *design and preview* tool plus a *profile compiler*. The handoff is the product.

## Status

**M3 — Measurement-driven design.** Load a headphone measurement, overlay a built-in or
custom target, and auto-fit a correction curve in one click. Ten bands in an `AudioWorklet`,
per-channel routing, undo, level-matched A/B, and a profile library with `ParametricEQ.txt`
and lossless JSON import/export. The bundled targets match AutoEQ's published curves within
0.05 dB; a 10-band fit runs in under 150 ms and typically cuts residual error from ~4 dB to
under 1 dB.

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
- 10 parametric bands: peak, low shelf, high shelf, low pass, high pass, notch
- Per-band channel routing: stereo, left, or right
- Drag a node on the graph to set frequency and gain; drag vertically on pass filters to set Q
- Shelves expose the RBJ slope `S` directly, and export converts it to the Q Equalizer APO expects
- Automatic preamp: offsets the largest boost so nothing clips
- Click-free bypass with RMS gain matching, so A/B compares tone rather than loudness
- Undo/redo with `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, or `Ctrl/Cmd+Y` (50 steps)
- The audio device is released whenever nothing is playing, so USB and Bluetooth
  headsets don't idle-hiss
- Live output peak meter
- Save, load, duplicate, and delete profiles with a device key
  (model + connection + codec + ANC)
- Profiles live in IndexedDB and never leave the browser
- Import AutoEQ / Equalizer APO / Peace / Wavelet `ParametricEQ.txt`
- Export `ParametricEQ.txt`, back up the whole library as lossless JSON, or copy the
  text profile to the clipboard
- Imported preamp is honoured when it asks for extra headroom
- Warns, without blocking, when a loaded profile was tuned for a different connection,
  codec, or ANC state than the one currently set
- Import a measurement from Squig.link, REW, AutoEQ, or any `freq, dB` table
  (comma, semicolon, tab, or whitespace; headers and comments are skipped)
- Normalise the measurement to 1 kHz, 500 Hz, a 200–2 kHz mean, or a custom reference,
  with 1/12, 1/6, or 1/3-octave display smoothing
- Three built-in targets — Harman over-ear 2018, Harman in-ear 2019, diffuse field — plus
  flat, none, and a custom target loaded from CSV
- Shape the target with tilt, bass, treble, and ear-gain offsets (±4–6 dB)
- Auto-fit 4–10 peaking bands to the measured-vs-target correction, with editable gain and
  Q limits, then keep tweaking the fitted bands like any others
- Live residual strip, residual RMS, and a before → after readout for each fit
- Measurement and target travel with the profile, so overlays survive a reload and a
  JSON round-trip

## Architecture

```
index.html
src/
  main.ts              wiring, transport, state
  style.css
  audio/
    dsp.ts             RBJ biquads, magnitude response, auto-preamp
    engine.ts          Web Audio graph, sources, gain matching
    fit.ts             deterministic multi-band auto-fit solver
    worklet/
      biquad-processor.ts   AudioWorklet cascade (transposed DF-II)
  formats/
    parametric.ts      ParametricEQ.txt parse + export
    profileJson.ts     lossless profile JSON
  storage/
    profiles.ts        IndexedDB profile store
  model/
    band.ts            Band model, defaults, formatting helpers
    measurement.ts     measurement CSV parsing, normalisation, smoothing
    target.ts          target selection, shape adjustments, custom targets
    targets.ts         bundled AutoEQ target data (121-point grid)
    profile.ts         Profile + device key model, validation
  ui/
    graph.ts           canvas response plot, overlays, pointer interaction
    bandList.ts        per-band controls
    measurePanel.ts    measurement, target, and auto-fit UI
    profilePanel.ts    profile library and import/export UI
```

Signal flow:

```
input ──► preamp ──► worklet cascade (10 biquads, L/R) ──► eqGain ──┐
  └──────────────────────────────────────────► dryTrim ──► dryGain ──┴──► out ──► analyser ──► destination
```

Bypass crossfades `eqGain` against `dryGain` rather than tearing the chain down, so A/B
switching is click-free. `dryTrim` follows the RMS ratio of the two paths, which keeps the
comparison honest while audio plays.

Coefficients are computed once on the main thread and posted to the worklet, so the graph,
the preview, and the future export all share one implementation. Each config change
crossfades the old cascade into the new one, which avoids clicks and the instability of
interpolating coefficients directly.

## Known gaps (by design, for now)

- The auto-fit solver places peaking bands only; shelves are still a manual choice.
- Targets are sampled on a 12-points-per-octave grid, so extreme narrow features are
  smoothed to that resolution (measured error stays under 0.1 dB).
- No lookahead limiter, service worker, or full accessibility pass yet — M4.
- `ParametricEQ.txt` carries the enabled bands only. JSON is the lossless format for
  disabled bands, per-channel routing, shelf slopes, and the measurement/target context.
- Desktop-first. Mobile works but the layout is tighter.

## Roadmap

| Milestone | Scope |
|---|---|
| M0 | Playback, preamp, 5 bands, graph ✅ |
| M1 | AudioWorklet cascade, 10 bands, all filter types, per-channel, undo, gain-matched A/B ✅ |
| M2 | Profiles, `ParametricEQ.txt` import/export, JSON, device keys ✅ |
| M3 | Measurement CSV overlay, target curves, auto-fit solver ✅ |
| M4 | Limiter, PWA, accessibility pass |

See [`PRD.md`](./PRD.md) for the full requirements.
