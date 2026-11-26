# Timbre

A browser-based workbench for designing headphone and earphone EQ curves.

Drag a curve, hear it instantly, then export the profile to whatever actually applies EQ on
your machine.

> **Timbre is not a system-wide equalizer.** A browser can only process audio it owns. Timbre
> is a *design and preview* tool plus a *profile compiler*. The handoff is the product.

## Status

**M4 — Limiter, offline, and accessibility.** A lookahead true-peak limiter guards the
master output at −0.3 dBTP, the app installs as a PWA and reloads with no network, and the
whole workbench is operable from the keyboard. Lighthouse accessibility is 100 on the
production build.

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
npm run preview    # serve dist/ and exercise the service worker
npm run typecheck  # types only
```

The production build registers a service worker on first load, so it keeps working after a
reload with the network off. Serve it from a real origin (not `file://`) for the service
worker and install prompt to be available.

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
- Live output peak meter, measured after the limiter
- A 5 ms lookahead limiter holds the master at −0.3 dBTP using a 4× windowed-sinc true-peak
  detector, so inter-sample peaks from EQ boosts cannot clip the output. A `LIM` indicator
  shows current gain reduction
- Installs as a PWA and works offline after the first visit; the service worker precaches the
  shell, icons, and hashed assets, and a new deploy replaces the old cache automatically
- Full keyboard operation: focus the graph and use the arrow keys to nudge frequency and
  gain (`Shift` for fine steps), `[`/`]` for Q, `Delete` to disable; globally, `Space`
  plays/pauses, `B` bypasses, `A` adds a band, `E` exports, `1`–`9` select a band, and
  `Esc` clears the selection
- WCAG 2.2 AA groundwork: skip link, labelled landmarks, visible focus, screen-reader
  descriptions for the canvas and meter, and `prefers-reduced-motion` support
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
public/
  manifest.webmanifest   PWA metadata
  icon-*.png, icon.svg   install icons
src/
  main.ts              wiring, transport, state, keyboard shortcuts
  pwa.ts               production-only service-worker registration
  style.css
  audio/
    dsp.ts             RBJ biquads, magnitude response, auto-preamp
    engine.ts          Web Audio graph, sources, limiter, gain matching
    fit.ts             deterministic multi-band auto-fit solver
    worklet/
      biquad-processor.ts   AudioWorklet cascade + true-peak limiter
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
  └──────────────────────────────────────────► dryTrim ──► dryGain ──┴──► outGain
                                                                           │
                    destination ◄── masterAnalyser ◄── lookahead limiter ◄─┘
```

Bypass crossfades `eqGain` against `dryGain` rather than tearing the chain down, so A/B
switching is click-free. `dryTrim` follows the RMS ratio of the two paths, which keeps the
comparison honest while audio plays. The limiter sits after the mix, so it protects both the
EQ and bypass paths, and the peak meter reads what actually reaches the device.

The service worker is generated at build time by a small Vite plugin (`offlineShell` in
`vite.config.ts`). It precaches `index.html`, the manifest and icons, and every hashed asset;
the cache name is derived from that file list, so a deploy installs a fresh cache and deletes
the old one. Navigations are network-first with a cached-shell fallback; assets are
cache-first. It is registered only in production, and never blocks startup if it fails.

Coefficients are computed once on the main thread and posted to the worklet, so the graph,
the preview, and the future export all share one implementation. Each config change
crossfades the old cascade into the new one, which avoids clicks and the instability of
interpolating coefficients directly.

## Known gaps (by design, for now)

- The auto-fit solver places peaking bands only; shelves are still a manual choice.
- Targets are sampled on a 12-points-per-octave grid, so extreme narrow features are
  smoothed to that resolution (measured error stays under 0.1 dB).
- The limiter adds 5 ms of latency to every path. That is inaudible for EQ preview but is
  worth knowing if you route the output into a recording.
- Cross-browser verification so far is Chromium-only (Chrome and Edge). Firefox and Safari
  have not been through the manual pass yet.
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
| M4 | Lookahead limiter, PWA/offline, accessibility pass ✅ |

See [`PRD.md`](./PRD.md) for the full requirements.
