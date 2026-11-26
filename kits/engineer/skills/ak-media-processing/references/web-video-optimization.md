# Web Video Optimization

Four requests, one owner. Load only the section the request needs.

| Request | Section | Writes files? |
|---|---|---|
| "Compress this video" | [Compress](#compress) | A new derived file only |
| "Compare codecs / quality vs size" | [Compare](#compare) | New sample files only |
| "Audit the videos on our site" | [Audit](#audit) | No |
| "Optimize every video in the project" | [Scan and optimize](#scan-and-optimize) | Staged outputs, then reference edits on request |

Savings depend on the source. A screen recording exported at a high bitrate can
shrink a lot; an already web-encoded clip may not shrink at all. Report the
measured result, never a target percentage.

## Compress

```bash
python scripts/video_optimize.py hero.mov -w 1920              # H.264/MP4, fresh hero.optimized.mp4
python scripts/video_optimize.py hero.mov --codec vp9 -w 1920  # opt-in VP9/WebM companion
python scripts/video_optimize.py hero.mov -n                   # plan and commands only
python scripts/video_optimize.py hero.mov --json               # machine-readable receipt
```

What the script guarantees:

- The source is never modified, and an existing output is never overwritten
  silently. Without `-o` it writes `<name>.optimized.<ext>`, then
  `<name>.optimized-2.<ext>` on a rerun. An explicit existing `-o` needs
  `--replace-output`, which keeps the previous file as `<name>.bak-<UTC time>`.
- The encode is staged as a hidden `.partial` file. It is promoted only after a
  full decode, the expected display size, a duration within max(0.5 s, 2%) and
  the same audio/subtitle track count, the same frame count (unless `--fps`
  lowered it) and any alpha channel all check out. A failed, interrupted or
  terminated run stops FFmpeg and removes the staged file; a failed move into
  place restores the previous output.
- An output that is not smaller is rejected (exit 3) and deleted, unless
  `--keep-larger` says otherwise. With `--replace-output` it must also be
  smaller than the file it would replace, so an already optimized asset is
  never swapped for a larger one. The receipt records that file's size as
  `bytes.replaced`.
- `-n/--dry-run` runs only FFprobe and prints the plan.

Probing uses the display size (rotation and sample aspect ratio applied),
`avg_frame_rate` with an `r_frame_rate` fallback, the pixel format and bit
depth, HDR transfer, alpha, and every audio and subtitle stream. Dimensions are
never upscaled and always even.

Defaults that protect the asset:

- **Audio**: every audio track is re-encoded (`--audio encode`). `muted` in the
  HTML does not prove the track is unneeded, so dropping is explicit:
  `--audio drop`, or `--drop-silent-audio`, which drops audio only when every
  track's measured peak is at or below -60 dBFS.
- **Captions**: text subtitles become `mov_text` (MP4) or WebVTT (WebM).
  Image-based subtitles (PGS, DVD) cannot, so the run stops until you pass
  `--subtitles drop` or extract them separately.
- **Frame rate**: kept. Variable frame rate timing is passed through, so no
  frames are duplicated to a constant rate. `--fps` only lowers it.
- **HDR and alpha**: refused when the profile cannot carry them. VP9/WebM keeps
  alpha as `yuva420p`, including alpha WebM sources such as Remotion renders.
  `--allow-format-downgrade` accepts the loss explicitly: alpha is flattened,
  and HDR is tagged BT.709 without tone mapping, so its colors look washed out.
- **10-bit**: kept by HEVC, VP9 and AV1; H.264 encodes 8-bit and says so.

### Profiles

| `--codec` | Encoder | Container | Default CRF (range) | Notes |
|---|---|---|---|---|
| `h264` (default) | libx264 | MP4 | 23 (0-51) | Plays everywhere; always ship it as the fallback |
| `hevc` | libx265 | MP4 | 28 (0-51) | Tagged `hvc1` for Safari; limited in Firefox/Chrome without hardware |
| `vp9` | libvpx-vp9 | WebM | 33 (0-63) | Constant quality with `-b:v 0`; Opus audio; alpha capable |
| `av1` | libsvtav1, else libaom-av1 | MP4 | 35 (0-63) | Smallest at equal quality; slow; older Safari lacks it |

`--preset` keeps one vocabulary and maps it per encoder: x264/x265 names
directly, SVT-AV1 numeric presets, and `-cpu-used` for libvpx and libaom.
`--encoder` picks only among a profile's encoders (for example `libaom-av1`).
`--two-pass` is H.264 only and targets 70% of the source bitrate.

### Receipt

Every run prints (or emits with `--json`) the status, output path, bytes before
and after, codec, display size, fps, pixel format, track counts, encode
seconds, checks, warnings and the exact FFmpeg commands. Use `html_type` for the
`<source type>` attribute; it is absent when the container is not a web
format (for example H.264 in MKV):

```html
<video autoplay muted loop playsinline poster="hero.jpg">
  <source src="hero.optimized.webm" type='video/webm; codecs="vp9, opus"'>
  <source src="hero.optimized.mp4" type='video/mp4; codecs="avc1.64001F, mp4a.40.2"'>
</video>
```

List the smaller modern source first and keep the H.264 source last. A browser
downloads only one `<source>`, so extra codecs cost storage, not transfer.

## Compare

Compare on a representative excerpt before encoding a long video:

```bash
ffmpeg -ss 00:00:10 -t 4 -i source.mp4 -c copy sample.mp4   # cut on keyframes; re-encode with -c:v libx264 -crf 0 when exact
for crf in 20 23 26; do python scripts/video_optimize.py sample.mp4 -o "sample-h264-$crf.mp4" --crf "$crf" --keep-larger --json; done
python scripts/video_optimize.py sample.mp4 --codec vp9 --crf 33 --keep-larger --json
ffmpeg -i sample-h264-23.mp4 -i sample.mp4 -lavfi ssim -f null -   # SSIM; libvmaf when the build has it
```

`--keep-larger` matters here: a low CRF on an already compressed sample is
often larger, and without it the sample is rejected and deleted.

Pick samples with fine text, fast motion and dark gradients, since those show
artifacts first. A sample's size does not prove the full video's size; label any
extrapolation as an estimate and encode the full file before stating savings.

## Audit

The audit is read-only: it never encodes, moves or edits anything.

```bash
node scripts/capture_rendered_videos.mjs http://localhost:3000/ http://localhost:3000/pricing > rendered.json
python scripts/video_web_audit.py . --rendered rendered.json            # Markdown report
python scripts/video_web_audit.py . --rendered rendered.json --json     # inventory as JSON
```

1. **Static scan.** `video_web_audit.py` finds `<video>`, `<source>`, `poster`,
   imports and `url()` references in source, templates and CMS JSON/YAML,
   resolves local files, and probes them. External, CDN and adaptive (HLS/DASH)
   sources are listed as not inspected, with the reason.
2. **Rendered measurement.** `capture_rendered_videos.mjs` (Playwright, when
   installed) records `currentSrc`, the rendered CSS size, device pixel ratio
   and attributes at a phone and a desktop viewport. Use `--scroll` for lazy
   loads. Without a browser the audit still runs and marks target sizes as
   needing measurement.
   A bundler that fingerprints file names (`/assets/hero-4f3a.mp4`) serves
   URLs that cannot be matched to the source file, so those measurements
   are listed as skipped; measure against a dev server that serves the original
   paths instead.
3. **Target size.** Recommend at most `density × largest rendered CSS size`
   (density 2 by default) on both axes, never above the source. An asset with
   `controls` or a fullscreen/lightbox use keeps its resolution or gets a
   separate larger variant.
4. **Report.** One row per asset with every usage, bytes, display size, codec,
   bits per pixel per frame, proposed size, source confidence, risks, evidence
   and skipped items. An oversized asset (resolution) and an inefficient
   encode (high bits per pixel) are different findings. Savings are labelled
   estimated until an encode measures them.

Prefer a verified original over an existing compressed derivative as the encode
source, so quality is not lost twice.

## Scan and optimize

Run only when the user asks to change the project, and only on the audit's
inventory:

1. Encode each asset once per chosen profile and size from the best source
   with `video_optimize.py` (fresh derived paths; bound parallel encodes to
   the machine, for example two at a time).
2. Edit only references the project owns, keeping `poster`, captions
   (`<track>`), `autoplay`/`muted`/`loop`/`playsinline`, the H.264 fallback and
   any larger fullscreen variant. Commit or snapshot before the edit so it can
   be reverted.
3. Verify playback in the browser at a phone and a desktop size, and confirm
   `currentSrc` resolves to the new file.
4. Report storage savings and bytes transferred per playback separately, and
   list external work (CDN, CMS, deployment) instead of doing it.

Replacing or deleting an original asset is destructive; ask first.
