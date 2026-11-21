# Timbre — Product Requirements Document

| Field | Value |
|---|---|
| **Product** | Timbre |
| **Tagline** | Shape how your headphones sound — in the browser. |
| **Document version** | 1.0 (Draft) |
| **Status** | For review |
| **Owner** | — |
| **Last updated** | 2026-11-21 |
| **Target release** | v1.0 — 8 weeks from kickoff |
| **Platform** | Web (desktop-first), installable PWA |

---

## 0. TL;DR

Timbre is a browser-based workbench for designing headphone and earphone EQ curves. You load a track (or capture a tab), see the headphone's measured frequency response against a target curve, shape a correction by dragging filter nodes, hear the result immediately, and export the finished profile to whatever actually applies EQ on your machine — Equalizer APO, Wavelet, Poweramp, or PipeWire.

**Timbre is not a system-wide equalizer.** A browser cannot process audio it does not own. Timbre is a *design and preview* tool plus a *profile compiler*. That constraint is the product, not a limitation to be apologised for.

---

## 1. Naming

### 1.1 Recommendation

**Timbre** — the perceptual character of a sound, independent of pitch and loudness. It is precisely the property a headphone's frequency response determines and precisely what the user is trying to change.

- Wordmark: `timbre`
- Pronounced: *TAM-bər*
- Candidate domain: `timbre.app` (unverified)
- Fallback name: **Toneform**

### 1.2 Shortlist

| Name | Rationale | Risk |
|---|---|---|
| **Timbre** ★ | Name *is* the product; one word; zero explanation needed | Generic audio term; trademark search required |
| Toneform | Distinctive compound, no obvious collision | Slightly abstract |
| Earprint | "Fingerprint" of a headphone's response; personalization angle | Loose existing use in audiology marketing |
| Spline | Curve-fitting; software-native feel | Not obviously audio |
| Kerb | Minimal; the edge of a curve | Meaning is subtle |
| Munson | Fletcher–Munson equal-loudness contours | Reads like a surname |

### 1.3 Rejected (taken)

| Name | Collision |
|---|---|
| Pinna | pinna.fm — kids' audio streaming service |
| Auricle | auricle.io — open-ear headphone company |
| Tympan | tympan.org — open-source hearing-aid hardware |

### 1.4 Naming tasks

- [ ] Trademark search (USPTO/EUIPO) for "Timbre" in class 9 (software) and 42 (SaaS)
- [ ] Domain availability: `timbre.app`, `timbre.audio`, `getTimbre.com`
- [ ] GitHub org / npm scope reservation

---

## 2. Problem Statement

Every headphone is sold with an arbitrary frequency response. Harman's listener-preference research shows that most people prefer a consistent target curve, yet almost no consumer headphone ships tuned to one. The fix — parametric EQ — is well understood, but the tooling is fragmented across four separate jobs:

1. **Find** your headphone's measured response (Squig.link, RTINGS, AutoEQ database)
2. **Design** a correction curve (manual maths, or copy someone else's filters)
3. **Hear** the result before committing (almost nobody can)
4. **Apply** it to your actual playback chain (Equalizer APO, Wavelet, Poweramp, PipeWire)

No single tool covers all four. AutoEQ generates filters but offers no visual design loop. Squig.link graphs beautifully but exports nothing usable. Equalizer APO is Windows-only and hostile to newcomers. Wavelet is Android-only. MixPhones (the closest web competitor) covers find → design → export but has no measurement overlay workflow, no solver transparency, and no per-channel support.

**The gap:** a zero-install, cross-platform place to *see, shape, hear, and export* a headphone correction.

---

## 3. Goals and Non-Goals

### 3.1 Goals

| ID | Goal | Measure of success |
|---|---|---|
| G1 | A user can go from landing page to hearing an EQ'd track in under 30 seconds | Median time-to-first-sound < 30 s |
| G2 | A user can design a correction against a real measured response without owning a measurement rig | ≥ 60% of sessions load a measurement or AutoEQ profile |
| G3 | A user can export a profile that works, unmodified, in a real system-wide EQ | Export → successful import rate ≥ 90% (user-reported) |
| G4 | The preview is trustworthy enough to make decisions on | Filter chain matches exported coefficients within ±0.1 dB |
| G5 | Nothing leaves the device | Zero network requests carrying audio or profile data |

### 3.2 Non-Goals

| Not doing | Reason |
|---|---|
| System-wide EQ of other apps | Impossible in a browser. Hand off via export. |
| Spotify / Apple Music / DRM'd audio processing | EME gives no PCM access. Tab capture returns silence. |
| Acoustic measurement (mic + coupler) | Browser mic is uncalibrated, no coupler, no repeatability. Out of scope permanently. |
| Native mobile app | Web PWA only for v1. |
| Accounts, cloud sync, social feed | v1 is local-first, no backend. |
| Hardware / firmware flashing | Out of scope. |
| AutoEQ-style bulk database hosting | Import from AutoEQ instead of rehosting. Revisit in v2. |

---

## 4. Target Users

### P1 — The Curious Listener *(primary)*
Owns one decent pair of headphones or IEMs. Has read that "EQ makes them better" but doesn't know what a Q factor is. Wants a preset that sounds good, fast.

**Needs:** one-click target matching, plain-language labels, obvious A/B.
**Frustrates them:** raw filter tables, dB/Q jargon, installs.

### P2 — The Measurement Hobbyist *(primary)*
Has Squig.link bookmarks. Knows what a 6 kHz coupler resonance is. Cares whether the shelf is S=1 or Q=0.7.

**Needs:** exact coefficient fidelity, CSV import, per-channel, shelf-slope control, solver constraints.
**Frustrates them:** hidden auto-magic, rounded values, filters they can't inspect.

### P3 — The Producer / Mixer *(secondary)*
Needs neutral monitoring on headphones they already own. Distrusts anything that changes level during A/B.

**Needs:** gain-matched bypass, preamp discipline, limiter, low-latency playback.
**Frustrates them:** louder-is-better A/B, clipping, resampling artifacts.

### P4 — The Tinkerer *(secondary)*
Wants to publish a profile for an obscure IEM nobody has measured.

**Needs:** manual band entry, shareable links, JSON export.
**Frustrates them:** no way to share, no way to name a device.

---

## 5. Competitive Landscape

| Product | Platform | Find | Design | Hear | Export | Gap Timbre exploits |
|---|---|---|---|---|---|---|
| **AutoEQ** | Web/CLI | ✅ | ⚠️ auto only | ❌ | ✅ | No manual design, no preview |
| **Squig.link** | Web | ✅ | ⚠️ | ❌ | ⚠️ | Graphs, not a workflow |
| **MixPhones** | Web | ✅ | ✅ | ✅ | ✅ | No CSV overlay, no solver transparency, no per-channel, no L/R |
| **Equalizer APO + Peace** | Windows | ❌ | ✅ | ✅ | n/a | Windows only, install required, steep curve |
| **Wavelet** | Android | ✅ (AutoEQ) | ⚠️ | ✅ | n/a | Android only, no desktop design loop |
| **SoundSource** | macOS | ❌ | ✅ | ✅ | n/a | Paid, macOS only |
| **Sonarworks** | Win/mac | ✅ | ✅ | ✅ | n/a | Paid, per-headphone licensing, no browser |
| **Attune** | iOS | ⚠️ | ⚠️ | ✅ | ❌ | Closed, Apple only |

**Differentiators for v1:**
1. **Measurement-first design loop** — overlay your headphone's real CSV against a target and fit against *that*, not against a preset.
2. **Transparent solver** — every fitted band is editable, and the residual error is shown numerically.
3. **Format-faithful export** — coefficients and shelf slopes match the target format, not an approximation.
4. **Zero install, zero upload** — works offline as a PWA.

---

## 6. Scope by Release

### 6.1 MVP — v0.1 (internal alpha)

- Local file playback (drag/drop + file picker)
- Preamp, 8 parametric bands (peaking, low shelf, high shelf)
- Live magnitude plot
- Bypass and gain-matched A/B
- Single profile, in-memory only

### 6.2 v1.0 (public)

Everything in MVP plus:

- 10 bands, all filter types (PK, LS, HS, LP, HP, notch)
- Drag-to-edit graph with per-band handles
- Per-channel L/R with copy/link
- Target curve overlay + built-in targets (Harman IE 2019v2, Harman OE 2018, diffuse-field, flat)
- Measurement CSV import + overlay
- Auto-fit solver with editable output
- Profile CRUD in IndexedDB, device keying
- Import `ParametricEQ.txt` (AutoEQ / Equalizer APO / REW tolerant parser)
- Export to Equalizer APO, Wavelet, Poweramp, PipeWire, JSON
- Lookahead limiter + true-peak meter
- PWA / offline

### 6.3 v1.1 (post-launch)

- Tab capture (desktop Chrome/Edge only)
- Shareable profile links (compressed URL hash)
- Community profile browser (read-only, static index)
- EQ curve screenshot export

### 6.4 Explicitly out of scope for v1

- Microphone measurement
- Cloud accounts
- Mobile system-wide EQ
- VST/AU plugin builds
- Convolution / linear-phase FIR

---

## 7. Functional Requirements

Priority: **M** = must, **S** = should, **C** = could. Every **M** requires acceptance criteria.

### 7.A Audio Engine

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-A1 | Play a local audio file through the EQ chain | M | Drag-drop an MP3/FLAC/WAV; playback starts < 500 ms after drop; seeking works |
| FR-A2 | Auto preamp equal to negative of maximum positive filter gain | M | Adding +6 dB of boost sets preamp to −6 dB; output never exceeds −0.1 dBFS on a 0 dBFS sine |
| FR-A3 | 32-bit float internal processing, no intermediate clipping | M | +12 dB boost on a full-scale sine does not produce hard clipping before the limiter |
| FR-A4 | Ramp gains over 10–20 ms on every parameter change | M | Dragging a band produces no clicks or zipper noise (verified by ear + waveform capture) |
| FR-A5 | Lookahead limiter, ceiling −0.3 dBTP | S | 4× oversampled true-peak never exceeds ceiling |
| FR-A6 | Bypass toggles the whole chain without a click | M | A/B toggle is instantaneous and level-matched |
| FR-A7 | Gain-matched A/B | M | Measured loudness of A and B within ±0.2 LU |
| FR-A8 | Output device selection where supported | C | `AudioContext.setSinkId()` populates a device list in Chrome ≥ 110 |
| FR-A9 | Playback rate and loop controls | C | 0.5×–1.5×, loop region |

### 7.B Filter Model and Editing

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-B1 | 10 independent bands | M | Each band independently enabled/disabled |
| FR-B2 | Filter types: PK, LS, HS, LP, HP, notch | M | Each type produces the expected magnitude shape |
| FR-B3 | Per-band params: frequency, gain, Q | M | Ranges: f 20 Hz–20 kHz (log), gain −20…+15 dB, Q 0.1–18 |
| FR-B4 | Shelf slope (S) parameter for LS/HS | S | S 0.3–1.5, exported faithfully |
| FR-B5 | Drag a band handle in the graph to change f and gain | M | Pointer drag updates both; vertical drag = gain, horizontal = frequency |
| FR-B6 | Scroll/gesture on a handle changes Q | S | Ctrl+scroll or pinch adjusts Q by 0.1 steps |
| FR-B7 | Numeric entry with unit parsing | M | Accepts `1k`, `1000`, `1,000`, `-3.5`, `0.7` |
| FR-B8 | Per-band solo | C | Soloing one band mutes all others in the chain |
| FR-B9 | Per-channel L/R | M | Each band can be linked or unlinked; unlinked bands show two handles |
| FR-B10 | Copy band, reset band, delete band | M | All reversible via undo |
| FR-B11 | Undo/redo across all edits | M | ≥ 50 steps, keyboard shortcuts |
| FR-B12 | "Auto preamp" recomputes continuously | M | Updates within 1 frame of any gain change |

### 7.C Visualization

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-C1 | Magnitude plot 20 Hz–20 kHz, log frequency, 60 dB vertical range | M | Grid at 1/3-octave or better; labelled decades |
| FR-C2 | Combined chain response drawn as a single curve | M | Computed from biquad coefficients, not sampled from audio |
| FR-C3 | Individual band contributions shown on hover/selection | S | Selected band's own curve highlighted |
| FR-C4 | Target curve overlay | M | Toggleable; distinct colour; legend |
| FR-C5 | Measured response overlay | M | CSV import → smoothed curve overlaid |
| FR-C6 | Residual/error curve (measured + EQ − target) | S | Numeric RMS error displayed in dB |
| FR-C7 | Real-time spectrum analyser behind the curve | C | 2048-point FFT, smoothing control |
| FR-C8 | Peak meter and true-peak readout | S | Numeric dBFS, clip indicator latches |

### 7.D Measurements and Targets

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-D1 | Import frequency-response CSV | M | Parses Squig.link, REW, and generic `freq,dB` formats; handles comma/semicolon, header rows |
| FR-D2 | Normalize measurement to a reference point | M | User picks 1 kHz / 500 Hz / mean-200–2000 Hz / custom |
| FR-D3 | Built-in targets: Harman IE 2019v2, Harman OE 2018, diffuse-field, flat | M | Curves bundled as compact JSON, accurate to ±0.5 dB |
| FR-D4 | Custom target import | S | Same CSV parser |
| FR-D5 | Target tilt and bass/treble preference adjustments | S | ±6 dB tilt, ±6 dB bass shelf, ±6 dB treble shelf, ±4 dB ear-gain |
| FR-D6 | Smoothing (1/12, 1/6, 1/3 octave) | S | Applied to display only, never to the solver input silently |

### 7.E Auto-Fit Solver

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-E1 | Fit N bands to minimize (measured + EQ − target) | M | Runs in-browser; < 300 ms for 10 bands on a mid-range laptop |
| FR-E2 | Configurable band count (4–10) | M | Fewer bands = smoother, less exact |
| FR-E3 | Constrain frequency, Q, and gain ranges | M | User-editable min/max per parameter |
| FR-E4 | Penalize large gains (regularization) | M | A +10 dB boost costs more than two +5 dB bands |
| FR-E5 | Fit only within a user-defined frequency window | S | e.g. 20 Hz–10 kHz to ignore coupler resonance |
| FR-E6 | Show residual RMS error before/after | M | e.g. "2.8 dB → 0.9 dB" |
| FR-E7 | Fitted bands land in the editor as normal, editable bands | M | No hidden "auto" state |
| FR-E8 | Deterministic results | S | Same input → same output (seeded initialization) |

### 7.F Profiles and Persistence

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-F1 | Create, rename, duplicate, delete profiles | M | Persisted in IndexedDB; survive reload |
| FR-F2 | Profile stores: name, device key, bands, preamp, target, measurement ref | M | Full round-trip via JSON |
| FR-F3 | Device key = model + connection mode + codec | M | Free-text fields with autocomplete from past entries |
| FR-F4 | Warn on load if connection mode differs from profile | S | Non-blocking banner |
| FR-F5 | Export/import all profiles as a single JSON file | S | Versioned schema |
| FR-F6 | Request persistent storage | C | `navigator.storage.persist()` |

### 7.G Import / Export

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-G1 | Parse `ParametricEQ.txt` | M | Handles `Preamp:`, `Filter N: ON PK/LSC/HSC/LPQ/HPQ/NO`, comma decimals, `#` comments, unknown lines ignored |
| FR-G2 | Export Equalizer APO / Peace format | M | Byte-identical structure to AutoEQ output; imports cleanly into Peace |
| FR-G3 | Export Wavelet-compatible `ParametricEQ.txt` | M | Wavelet accepts the file without edits |
| FR-G4 | Export Poweramp preset | S | Correct key names for Poweramp's parametric EQ |
| FR-G5 | Export PipeWire `filter-chain` config | S | Valid config; `pw-cli` loads it without error |
| FR-G6 | Export JSON (lossless round-trip) | M | Includes shelf slope and per-channel data |
| FR-G7 | Copy to clipboard | M | One click, with confirmation |
| FR-G8 | Export warns when bands exceed format capability | M | e.g. PipeWire has no per-channel; warn and offer flattening |

### 7.H Playback Sources

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-H1 | Local file via drag/drop and picker | M | MP3, WAV, FLAC, OGG/Opus, M4A/AAC where the browser supports them |
| FR-H2 | Long files stream via media element, not full decode | M | A 2-hour file starts in < 1 s and does not exhaust memory |
| FR-H3 | Demo track bundled for first-run | M | Short, licensed-for-demo clip; instant play |
| FR-H4 | Tab audio capture (desktop Chrome/Edge) | C | Captures a tab's audio; shows a clear "DRM content will be silent" notice |
| FR-H5 | Microphone / line-in monitoring | C | Works with echo cancellation disabled; feedback warning shown |

### 7.I Sharing

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| FR-I1 | Share profile as a compressed URL hash | S | < 2 KB URL for a 10-band profile |
| FR-I2 | Open a shared link into the editor | S | No data leaves the device; state encoded in the fragment |
| FR-I3 | Export graph as PNG/SVG | C | Transparent background option |

---

## 8. Technical Requirements

| ID | Requirement |
|---|---|
| TR-1 | **Stack:** Vite + TypeScript, no backend, static hosting. Framework optional (Svelte preferred if used). |
| TR-2 | **Audio graph:** `MediaElementAudioSourceNode` → `GainNode` (preamp) → biquad cascade → limiter → `AudioDestinationNode`. |
| TR-3 | **Biquad cascade** implemented in an `AudioWorkletProcessor` for exact coefficients, per-sample parameter ramping, and shelf-slope fidelity. `BiquadFilterNode` is acceptable for MVP only. |
| TR-4 | **Why a worklet:** `BiquadFilterNode` shelves ignore `Q` (fixed S=1) and use RBJ coefficients; AutoEQ profiles assume a different shelf shape. Preview must match export. |
| TR-5 | **Coefficients:** RBJ Audio EQ Cookbook, computed at the live `AudioContext.sampleRate`, recomputed on rate change. |
| TR-6 | **Curve computation** for plotting uses the same coefficient generator, evaluated analytically — never by rendering audio. |
| TR-7 | **Solver:** Levenberg–Marquardt or bounded coordinate descent on log-magnitude error; 200 log-spaced points 20 Hz–20 kHz; analytic filter magnitude for speed. |
| TR-8 | **Storage:** IndexedDB via a thin wrapper (`idb-keyval` or similar). Versioned schema with migrations. |
| TR-9 | **No network:** app shell cached by service worker; zero analytics in v1; no audio or profile ever uploaded. |
| TR-10 | **`AudioContext`** created/resumed inside a user gesture (all browsers require this). |
| TR-11 | **Latency budget:** input-to-output < 30 ms on desktop with a 128–256 frame buffer. |
| TR-12 | **Rendering budget:** graph redraw < 8 ms; solver < 300 ms; no main-thread audio processing. |
| TR-13 | **Bundle budget:** < 250 KB gzipped initial JS, excluding demo audio. |

### 8.1 Browser Support Matrix

| Browser | Playback | Full EQ | Tab capture | Notes |
|---|---|---|---|---|
| Chrome / Edge ≥ 110 (desktop) | ✅ | ✅ | ✅ | Primary target; `setSinkId` available |
| Firefox ≥ 115 (desktop) | ✅ | ✅ | ❌ | No tab audio capture |
| Safari ≥ 17 (macOS) | ✅ | ✅ | ❌ | Codec support limited; test FLAC/Opus |
| Chrome (Android) | ✅ | ✅ | ❌ | Background audio may suspend |
| Safari (iOS) | ⚠️ | ✅ | ❌ | `AudioContext` suspends in background; no `getDisplayMedia` audio |

---

## 9. Data Model

```ts
type FilterType = 'PK' | 'LS' | 'HS' | 'LP' | 'HP' | 'NO';

interface Band {
  id: string;
  enabled: boolean;
  type: FilterType;
  freq: number;      // Hz, 20..20000
  gain: number;      // dB, -20..+15 (ignored for LP/HP/NO)
  q: number;         // 0.1..18
  slope?: number;    // S, shelves only, 0.3..1.5
  channel: 'stereo' | 'L' | 'R';
}

interface DeviceKey {
  model: string;         // "Sony WH-1000XM5"
  connection: 'wired' | 'bluetooth' | 'usb';
  codec?: string;        // "LDAC", "AAC", "SBC", "aptX"
  anc?: 'on' | 'off' | 'transparency';
}

interface TargetCurve {
  id: string;
  name: string;          // "Harman IE 2019v2"
  points: Array<[number, number]>; // [Hz, dB]
  builtin: boolean;
}

interface Measurement {
  id: string;
  name: string;
  points: Array<[number, number]>;
  source?: string;       // "squig.link/..."
  normalizedAt: number;  // Hz
  smoothing: 'none' | '1/12' | '1/6' | '1/3';
}

interface Profile {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  device: DeviceKey;
  preamp: number;
  bands: Band[];
  targetId?: string;
  measurementId?: string;
  notes?: string;
}
```

---

## 10. File Formats

### 10.1 Import — `ParametricEQ.txt` (AutoEQ / Equalizer APO / REW)

```
Preamp: -6.2 dB
Filter 1: ON PK Fc 105 Hz Gain 3.5 dB Q 0.70
Filter 2: ON LSC Fc 105 Hz Gain 4.0 dB Q 0.70
Filter 3: ON HSC Fc 10000 Hz Gain -2.0 dB Q 0.70
```

Parser rules:
- Case-insensitive keywords; `#` and `//` start comments.
- Accept `,` as decimal separator.
- Accept `PK`, `PEAK`, `LS`, `LSC`, `HS`, `HSC`, `LP`, `LPQ`, `HP`, `HPQ`, `NO`, `NOTCH`, `BP`.
- Ignore unknown lines rather than failing the whole file.
- `Preamp:` optional; recompute if absent.
- Report a summary: "Imported 5 bands, 1 preamp."

### 10.2 Export — Equalizer APO / Peace

Same structure as 10.1. Shelves emitted as `LSC`/`HSC` with `Q` derived from slope `S`:

```
Q = 1 / sqrt((A + 1/A) * (1/S - 1) + 2)   // A = 10^(gain/40)
```

### 10.3 Export — PipeWire

```conf
context.modules = [
  { name = libpipewire-module-filter-chain
    args = {
      node.description = "Timbre <profile-name>"
      filter.graph = {
        nodes = [
          { type = builtin label = bq_peaking   name = eq1 control = { "Freq" = 105 "Q" = 0.70 "Gain" = 3.5 } }
          { type = builtin label = bq_lowshelf  name = eq2 control = { "Freq" = 105 "Q" = 0.70 "Gain" = 4.0 } }
        ]
      }
    }
  }
]
```

### 10.4 Export — JSON

Full fidelity, including `slope`, `channel`, `device`, and target/measurement references. This is the only lossless format.

---

## 11. UX Specification

### 11.1 Screens

| Screen | Purpose | Key elements |
|---|---|---|
| **Landing** | Get to sound in one click | Drop zone, "Play demo track", one-line explainer, browser-support note |
| **Workbench** | The product | EQ graph (dominant), band list, transport, source panel, target/measurement panel |
| **Profiles** | Manage saved work | List, search, device key badges, duplicate/export |
| **Export** | Compile the profile | Format tabs, preview text, copy/download, compatibility warnings |
| **Help** | Teach the concepts | "What is Q?", "Why preamp?", "Cable vs Bluetooth" |

### 11.2 EQ Graph Interaction

- Horizontal axis: log frequency, 20 Hz–20 kHz. Vertical: ±24 dB.
- Band handle = filled circle. Drag = frequency + gain. Ctrl/⌘+scroll = Q.
- Double-click empty graph = add band at that point.
- Right-click handle = context menu (solo, copy, reset, delete).
- Selected band's individual curve is highlighted; others dimmed to 40%.
- Target curve: dashed, low-contrast. Measured: solid, 1 px, distinct hue.
- Residual band across the top of the plot when a measurement is loaded.

### 11.3 First-Run Flow

1. Landing → "Play demo" or drop a file.
2. A default 3-band "gentle" profile is loaded and audible.
3. Coach marks: (a) drag a dot, (b) toggle A/B, (c) "Want a preset? Load AutoEQ."
4. Prompt to save the profile only after the first edit.

### 11.4 Error and Edge States

| State | Behaviour |
|---|---|
| Unsupported codec | Inline message naming the format; suggest converting |
| DRM tab captured | "This tab is protected — audio can't be processed" |
| `AudioContext` suspended | Overlay with a single "Start audio" button |
| No IndexedDB (private mode) | Session-only mode with a persistent banner |
| Export exceeds format limits | Warning with a one-click "flatten to stereo" |
| Profile loaded with different connection mode | Non-blocking banner |

### 11.5 Keyboard Shortcuts

`Space` play/pause · `B` bypass · `A` add band · `Del` delete band · `⌘/Ctrl+Z` undo · `⌘/Ctrl+Shift+Z` redo · `E` export · `1–9` select band.

---

## 12. Non-Functional Requirements

| Area | Requirement |
|---|---|
| **Performance** | First paint < 1.5 s on a mid-range laptop over 4G; TTI < 3 s |
| **Accessibility** | WCAG 2.2 AA; all graph interactions mirrored by numeric inputs; full keyboard operation; respects `prefers-reduced-motion` |
| **Privacy** | No accounts, no telemetry, no uploads. All processing local. |
| **Offline** | Full functionality after first load, via service worker |
| **Localisation** | English only for v1; all strings externalised |
| **Resilience** | Corrupt profile in IndexedDB is skipped, not fatal |
| **Security** | No third-party scripts in v1; strict CSP |

---

## 13. Success Metrics

| Metric | Definition | Target (90 days) |
|---|---|---|
| **Activation** | Visitor who plays audio and edits ≥ 1 band | 40% |
| **Time to first sound** | Landing → audio playing | Median < 30 s |
| **Profile creation** | Sessions that save a profile | 25% |
| **Export rate** | Profile creators who export | 30% |
| **Solver adoption** | Sessions using auto-fit | 50% |
| **D7 retention** | Returning within 7 days | 15% |
| **Export failure reports** | User-reported broken exports | < 5% |

---

## 14. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Users expect system-wide EQ and bounce | High | High | State the constraint in the hero copy; make export the primary CTA; link to native tools per OS |
| R2 | Preview ≠ export (shelf coefficient mismatch) | High | High | Implement biquads in an AudioWorklet; regression-test preview vs. exported coefficients to ±0.1 dB |
| R3 | DRM tab capture returns silence | Medium | Medium | Detect and explain; never advertise tab capture as a music-service feature |
| R4 | MixPhones and others occupy the niche | High | Medium | Differentiate on measurement overlay + solver transparency + per-channel |
| R5 | iOS Safari suspends audio in background | High | Low | Document it; desktop-first positioning |
| R6 | Solver produces unusable filters (huge Q, clipping) | Medium | High | Bounded parameters, gain regularization, post-fit sanity check |
| R7 | "Timbre" trademark collision | Medium | High | Clear before launch; Toneform as fallback |
| R8 | Users boost +12 dB and blame the tool for distortion | High | Medium | Cap default boosts, warn above +6 dB, always auto-preamp |
| R9 | Measurement CSVs vary wildly in format | High | Medium | Tolerant parser + preview of parsed points before applying |
| R10 | Scope creep into native app | Medium | High | Non-goals are contractual for v1 |

---

## 15. Milestones

| Milestone | Duration | Scope | Exit criteria |
|---|---|---|---|
| **M0 — Skeleton** | Week 1 | Vite + TS, file playback, preamp, 1 band, curve plot | A track plays and one band audibly changes it |
| **M1 — Engine** | Weeks 2–3 | 10 bands, all filter types, worklet cascade, drag editing, A/B, undo | Engine matches analytic curve within 0.1 dB |
| **M2 — Profiles** | Weeks 4–5 | IndexedDB, profile CRUD, `ParametricEQ.txt` import/export, APO export | Round-trip import → export is lossless |
| **M3 — Intelligence** | Weeks 6–7 | Measurement CSV, targets, solver, residual display | Solver < 300 ms, RMS error < 1.5 dB on 5 test headphones |
| **M4 — Ship** | Week 8 | Limiter, per-channel, PWA, a11y pass, docs | Lighthouse a11y ≥ 95; offline works; 3 browsers verified |

---

## 16. Open Questions

| # | Question | Owner | Needed by |
|---|---|---|---|
| Q1 | Is "Timbre" clear for trademark and domain? | — | M0 |
| Q2 | Bundle demo audio, or synthesize a test tone? (licensing) | — | M0 |
| Q3 | Ship our own Harman target data, or link to AutoEQ's? (licensing/accuracy) | — | M3 |
| Q4 | Should the solver be fully automatic or always show a confirm step? | — | M3 |
| Q5 | Do we need a static profile-sharing index at launch, or is URL-hash enough? | — | M4 |
| Q6 | Is a WebGL renderer needed for the graph at 10 bands? (probably not) | — | M1 |

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| **Biquad** | A two-pole, two-zero IIR filter; the building block of parametric EQ |
| **Q** | Filter sharpness; higher Q = narrower band |
| **Shelf (LS/HS)** | A filter that boosts/cuts everything below (low) or above (high) a corner frequency |
| **Preamp** | A static gain applied before the filters, used to prevent clipping |
| **Target curve** | The frequency response you're aiming for (e.g. Harman) |
| **Harman curve** | A research-derived preferred response; separate versions for over-ear and in-ear |
| **Coupler** | The artificial ear used for measurement (IEC 60318-4 for IEMs) |
| **True peak** | Peak level after reconstruction filtering; the honest measure for clipping |
| **LUFS** | Loudness units relative to full scale; used for gain-matched A/B |

## Appendix B — References

- AutoEQ — https://github.com/jaakkopasanen/AutoEq
- Squig.link — https://squig.link
- Equalizer APO — https://sourceforge.net/projects/equalizerapo/
- Wavelet — https://github.com/Pittvandewitt/Wavelet
- RBJ Audio EQ Cookbook — https://www.w3.org/TR/audio-eq-cookbook/
- Web Audio API — https://www.w3.org/TR/webaudio/
- Harman target research (Olive, Welti, McMullin) — AES papers
- IEC 60318-4 — Occluded-ear simulator
- MixPhones (competitor) — web-based headphone EQ designer

---

*End of document.*
