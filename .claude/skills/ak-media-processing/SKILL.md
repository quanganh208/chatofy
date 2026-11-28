---
name: ak-media-processing
description: "Process media with FFmpeg (video/audio), ImageMagick (images) and RMBG (AI background removal)."
when_to_use: "Invoke for encoding, conversion, thumbnails, HLS/DASH streaming, or to compress and audit web video."
category: media
keywords: [ffmpeg, imagemagick, video, audio, images]
license: Proprietary
argument-hint: "[input-file] [operation]"
metadata:
  author: agentkit
  version: "1.1.0"
---

# Media Processing Skill

Process video, audio, and images using FFmpeg, ImageMagick, and RMBG CLI tools.

Use the user/repository output path first. Invoke an installed organization capability only
when organizing multiple assets is part of the task; a one-file operation needs none.
Preserve source files by default, write batch outputs to a separate directory, and verify
codec/dimensions/duration or image metadata. In-place recipes require explicit overwrite scope.

## Web Video

This skill owns video compression and web delivery; composition skills hand
their renders here. Load [`references/web-video-optimization.md`](references/web-video-optimization.md)
and only the section the request needs:

| Request | Run |
|---|---|
| "Compress this video for the web" | `scripts/video_optimize.py <file>`: verified H.264 output plus a receipt |
| "Compare quality and size across codecs" | `video_optimize.py --codec vp9/hevc/av1` on a sample, then SSIM |
| "Audit the videos on our site" | `scripts/video_web_audit.py` with `capture_rendered_videos.mjs`; read-only |
| "Optimize every video in the project" | The audit inventory, then staged encodes and reverted-on-request reference edits |

`video_optimize.py` never touches the source or overwrites an existing output,
keeps audio, captions and frame rate unless told otherwise, keeps H.264 as the
fallback, and promotes an encode only after it decodes cleanly and is smaller
(than the source, and with `--replace-output` than the file it replaces).
Report measured bytes, never an expected percentage.

## Tool Selection

| Task | Tool | Reason |
|------|------|--------|
| Video encoding/conversion | FFmpeg | Native codec support, streaming |
| Audio extraction/conversion | FFmpeg | Direct stream manipulation |
| Image resize/effects | ImageMagick | Optimized for still images |
| Background removal | RMBG | AI-powered, local processing |
| Batch images | ImageMagick | mogrify for in-place edits |
| Video thumbnails | FFmpeg | Frame extraction built-in |
| GIF creation | FFmpeg/ImageMagick | FFmpeg for video, ImageMagick for images |

## Installation

```bash
# macOS
brew install ffmpeg imagemagick
npm install -g rmbg-cli

# Ubuntu/Debian
sudo apt-get install ffmpeg imagemagick
npm install -g rmbg-cli

# Verify
ffmpeg -version && magick -version && rmbg --version
```

## Essential Commands

```bash
# Video: Convert/re-encode
ffmpeg -i input.mkv -c copy output.mp4
ffmpeg -i input.avi -c:v libx264 -crf 22 -c:a aac output.mp4

# Video: Extract audio
ffmpeg -i video.mp4 -vn -c:a copy audio.m4a

# Image: Convert/resize
magick input.png output.jpg
magick input.jpg -resize 800x600 output.jpg

# Image: Batch resize
mogrify -resize 800x -quality 85 *.jpg

# Background removal
rmbg input.jpg                          # Basic (modnet)
rmbg input.jpg -m briaai -o output.png  # High quality
rmbg input.jpg -m u2netp -o output.png  # Fast
```

## Key Parameters

**FFmpeg:**
- `-c:v libx264` - H.264 codec
- `-crf 22` - Quality (0-51, lower=better)
- `-preset slow` - Speed/compression balance
- `-c:a aac` - Audio codec

**ImageMagick:**
- `800x600` - Fit within (maintains aspect)
- `800x600^` - Fill (may crop)
- `-quality 85` - JPEG quality
- `-strip` - Remove metadata

**RMBG:**
- `-m briaai` - High quality model
- `-m u2netp` - Fast model
- `-r 4096` - Max resolution

## References

Detailed guides in `references/`:
- `ffmpeg-encoding.md` - Codecs, quality, hardware acceleration
- `ffmpeg-streaming.md` - HLS/DASH, live streaming
- `ffmpeg-filters.md` - Filters, complex filtergraphs
- `imagemagick-editing.md` - Effects, transformations
- `imagemagick-batch.md` - Batch processing, parallel ops
- `rmbg-background-removal.md` - AI models, CLI usage
- `web-video-optimization.md` - Compress, compare, audit and optimize web video with receipts
- `common-workflows.md` - Raw FFmpeg recipes, responsive images, GIF creation
- `troubleshooting.md` - Error fixes, performance tips
- `format-compatibility.md` - Format support, codec recommendations
