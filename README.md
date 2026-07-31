# KlipPharma

KlipPharma turns long-form video into ranked, captioned vertical clips and can also assemble a batch into one CapCut-style Auto-Mix. The night-studio workspace supports mixed AI/manual batch uploads, creator-specific editorial modes, multilingual transcription, translated captions and optional AI-dubbed audio, audience-aware clip scoring, browser-safe previews, adjustable start/end points, editable captions and watermarks, saved project history, feedback, and downloadable 9:16 MP4 exports.

**We pick the dopest klips!**

## Version 0.29.2 — Silent camera-roll video handling

- Video-only MP4/MOV files no longer fail during audio extraction.
- KlipPharma detects when a source has no audio stream and opens it in the visual/manual editor automatically.
- Silent sources remain editable and can receive uploaded music or sounds through the klip audio mixer.

## Version 0.29.1 — Mobile camera-roll upload fix

- The upload surface now uses the real full-size file control instead of a `display:none` input, so tapping it opens Photos/Files reliably on iPhone and iPad.
- Selected files are kept in application state and appended directly to the upload request, avoiding iOS Safari's unsupported `DataTransfer` file-list behavior.
- Mobile users can select additional footage repeatedly, remove files, and upload MOV, M4V, MP4, WebM, and common audio formats.

## Version 0.29.0 — Individual-klip audio mixer and reliable translated voices

- Restores the audio mixer inside every individual klip editor, including source volume, added-sound volume, start time, looping, fades, and automatic ducking.
- Adds per-klip MP3, WAV, M4A, AAC, OGG, and FLAC upload, playback, replacement, and removal.
- Moves translated-audio language and AI-voice selection into each klip so the chosen Spanish or other-language voice is saved and used by the final renderer.
- Changing the voice, language, or mix invalidates the old render and requires an exact final-preview rebuild before download.

## Version 0.28.0 — Production YouTube importer

- Railway is explicitly configured to build the Dockerfile that installs FFmpeg and the pinned `yt-dlp` runtime.
- YouTube imports now fall back from the `yt-dlp` executable to the Python module on hosts where the executable is not exposed on `PATH`.
- The v0.27 honest composite preview remains included.

## Version 0.27.0 — Honest live composite preview

- The editor preview now shows caption words, caption style, and the selected top/middle/bottom safe-zone position while the source plays.
- The editor preview now shows the creator watermark in its selected corner and the locked KlipPharma mark for free exports.
- Live caption chunks use the same timing/chunking rules as the final MP4 renderer, so the editing preview reflects the saved instructions before rendering.
- The exact rendered MP4 review remains the final source of truth before download.

## Version 0.26.0 — Exact final preview + faithful overlays

Every individual klip now renders an exact pre-export MP4 preview before the download is offered. The preview uses the same finished file as export, so edited captions, headline or picture overlays, crop position, timing, watermarks, and audio can be reviewed together. Caption rendering now uses a fixed 1080×1920 canvas to prevent oversized words from covering the speaker. Meme text position, selected text color, white/black box color, box style, and display timing are preserved literally; new overlays default to the full selected klip.

## Version 0.25.1 — Pro batch entitlement fix

- The 1–10 finished-klip selector now honors the existing beta Pro-feature flag for owner testing.
- When `PRO_FEATURES_OPEN=false`, the selector remains restricted to Pro, Studio, and Business accounts.

## Version 0.25.0 — Transparent progress + Pro batch output

- Shows byte-level upload progress for every local or direct-cloud source.
- Shows each video’s queue position, processing phase, progress bar, and full failure reason.
- Failed processing no longer appears as a misleading 100% completed batch.
- Pro, Studio, and Business users can request 1–10 finished AI klips across the entire batch.
- KlipPharma ranks candidates from all uploaded sources and keeps the requested top total.

## Version 0.24.0 — Business workspaces

The $199/month Business plan is now a real five-account workspace rather than a display-only price. Business owners can invite teammates with secure seven-day links, assign owner/admin/editor/viewer permissions, share project history and exports, revoke pending invitations, and remove members. Owners control centralized Stripe billing; admins manage people; editors create and edit; viewers review without changing shared work. Business Annual is $1,990/year, giving the same two-month annual discount as the individual tiers.

## Version 0.23.0 — Creator dashboard and plan catalog

Signed-in creators now have an account Dashboard with their email, membership date, current plan, renewal or access-end date, real account-scoped upload history, and upload/klip/completion totals. Billing supports $29 Creator and $79 Pro monthly tiers plus discounted yearly versions. Creator members continue to see a clear Pro upgrade path and can receive a Stripe-configured 15% discount on their first monthly Pro charge. The upgrade prompt disappears once the account reaches Pro.

## Version 0.21.2 — Custom creative colors

Meme & Overlay Studio now includes a full text color picker plus an independent black-or-white box color control. Solid, transparent, and no-box styles remain available, and the chosen colors are preserved in previews and final rendered exports.

## Version 0.21.1 — Beta creative access

During the pre-payment beta, every signed-in creator can use **Meme & Overlay Studio**. Set `PRO_FEATURES_OPEN=false` after paid plans launch to restore Pro-only access. Free/demo exports continue to carry the KlipPharma watermark.

Creators can turn any recommended klip into a meme-style social edit before export. Enable **Meme & Overlay Studio** inside a klip to:

- write and revise a large headline or meme caption;
- choose top, middle, or bottom placement, three sizes, colors, and box styles;
- upload a PNG, JPG, WebP, or GIF reaction image, logo, or illustration;
- place that image above or below the video in a split-screen layout or use it as a logo/sticker;
- set exactly when the creative overlay appears and disappears;
- preview the composition and burn it into the final H.264/AAC MP4.

The access flag is enforced in both the interface and server. When beta access is closed, paid-plan checks resume without another code change.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3100`.

KlipPharma is a standalone FPAI product. Keep it in its own project folder and
run it on port `3100`; the FPAI Tax OS can continue using its existing port.

## Requirements

- Node.js 20+
- `OPENAI_API_KEY` in `.env.local`

FFmpeg is bundled through `ffmpeg-static`, so a separate Homebrew FFmpeg install is not required.

## Accounts and production project ownership

Version 0.14 adds an optional production account layer without changing the local workflow. With no `DATABASE_URL` and `AUTH_MODE=off`, KlipPharma automatically uses one local owner and opens directly to the studio. This is the mode used by `npm run dev` on your Mac.

For a deployed private service, provision PostgreSQL and set:

```bash
AUTH_MODE=required
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
PGSSLMODE=require
NODE_ENV=production
```

On startup, KlipPharma creates its `users`, `sessions`, and `projects` tables. Creators can register and sign in; passwords are salted and hashed with Node's scrypt implementation, session tokens are stored as SHA-256 hashes, and the browser receives an HttpOnly, SameSite cookie. Project lists, source previews, uploaded audio, and MP4 exports are checked against the signed-in owner. Production mode deliberately refuses to start when `DATABASE_URL` is missing.

PostgreSQL stores project metadata and ownership. Without R2, media remains on the local filesystem; with R2 configured, new sources upload directly to private object storage and can be recovered by the processor. Rendered exports still live on the processor filesystem, so moving exports to R2 and adding a durable FFmpeg queue are the next infrastructure slice.

## Private Cloudflare R2 uploads

When all R2 settings in `.env.example` are present, KlipPharma switches the browser to private direct uploads automatically. The app issues a short-lived, owner-scoped presigned URL; the browser sends each source straight to R2, and the processor retrieves a private working copy only when FFmpeg needs it. Local development continues using the existing multipart upload route when R2 is not configured.

Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET`. Apply `config/r2-cors.json` to the bucket after replacing the placeholder production origin with the live KlipPharma domain. The upload credential should be scoped only to this bucket. Sources are capped at 1 GB in this release.

## Container deployment

`Dockerfile` packages the web app and FFmpeg runtime for a container host. `compose.production.example.yml` shows the required production environment without embedding secrets. Keep `/app/storage` on a persistent volume until rendered exports are moved to R2. The container exposes port 3100 and includes an application health check at `/api/health`.

## Editing a suggested klip

Each AI recommendation includes a playable source preview and start/end sliders. Drag either slider to correct the cut, then use **Preview selected cut** to watch only that selection. Klips may be up to 90 seconds long. The revised timestamps save automatically and are used by **Create vertical clip**.

Each klip also includes a 9:16 subject-framing control. The preview shows the actual vertical crop instead of the uncropped source. Move the horizontal focal slider or use Left, Center, and Right presets to center an off-axis speaker; the saved position is used by both the individual FFmpeg export and editable Auto-Mix moments.

Downloaded MP4 files use a Mac/iPhone-safe compatibility profile: H.264/AVC with an `avc1` video tag, `yuv420p`, constant 30 fps, AAC-LC stereo at 48 kHz, and fast-start metadata. These settings are used for individual klips, browser previews, and Auto-Mix outputs to improve loading in QuickTime, Photos, AirDrop, and social-platform uploaders.

Saved projects now include permanent deletion controls. Creators can delete an entire batch from Recent Harvests or the results screen, delete one source video and its klips, remove only an individual rendered MP4, remove an Auto-Mix MP4, or remove an uploaded mixer track. Confirmed deletions remove matching local source, preview, transcript audio, export, and project files, delete PostgreSQL metadata, and remove private R2 source objects when cloud storage is enabled.

KlipPharma first tries the original video in the browser, then converts camera formats such as MOV/HEVC into a browser-safe H.264 MP4. If a saved project predates this converter or playback fails, select **Retry preview** inside the preview panel. Preview conversion runs locally and does not use OpenAI credits. If an unusual source can only be converted without preview audio, the final rendered klip still uses the source audio.

## Batch processing

Select or drag up to 10 videos into the uploader. You can reopen the picker or drop additional files repeatedly; new videos are added to the existing tray instead of replacing it. Duplicates are ignored, and every file can be removed individually before processing. Every source receives its own progress row and grouped results section. KlipPharma processes two sources simultaneously and queues the rest to protect local CPU and memory. API transcription and clip-selection usage is charged separately for each source video.

Each file also has its own processing mode. **AI + captions** transcribes the source, ranks recommended moments, and prepares captioned exports. **Manual · no transcript** skips audio extraction, transcription, and AI clip selection, then opens a preview with the start/end cutter. Manual exports do not include automatic captions and do not use OpenAI credits.

## Creator modes

Before uploading, choose one of the large editorial workflow cards for the batch:

- **Smart Detect** balances hooks, context, payoff, emotion, and entertainment for mixed content.
- **Artist / Music** protects complete lyrical phrases, looks for memorable song and artist-story moments, and renders final audio at 256 kbps.
- **Podcast / Interview** keeps essential questions and answers together while prioritizing insights, debates, stories, humor, and reactions.
- **Monologue / Talking Head** trims slow introductions and prioritizes cold opens, lessons, hot takes, personal stories, and direct calls to action.

AI-generated recommendations include a short strategy lane so the creator can see whether a suggestion was selected as an insight, lyric moment, hot take, story, reaction, CTA, or another mode-appropriate angle.

## AI Auto-Klip batch recipe

Before processing, choose **Smart**, **15**, **30**, **45**, **60**, or **90 seconds** as the maximum starting length for every AI-enabled source in the batch. Smart lets the AI choose the shortest complete duration between 15 and 90 seconds. A timed recipe asks the AI for complete thoughts within the chosen maximum and the server enforces that limit. Recommendations remain editable afterward with the start/end scrub controls, up to the product-wide 90-second maximum. Manual/no-transcript sources skip the AI recipe.

## Language Studio

Before processing, choose the spoken language or leave it on **Auto detect**. The AI workflow saves the original timestamped transcript and can translate captions into English, Spanish, French, Portuguese, German, Italian, Japanese, Korean, Chinese, Arabic, or Hindi. Translated words appear in the existing caption editor, so creators can correct names, slang, lyrics, and phrasing before export.

When **AI translated voiceover** is enabled, KlipPharma generates speech from the translated caption text during the final render and keeps the original source sound quietly underneath. The chosen voice and translation settings apply to individual klips and Auto-Mix moments. Manual/no-transcript sources skip translation and dubbing. Translation uses the configured text model; voiceover uses `AI_SPEECH_MODEL` (default `gpt-4o-mini-tts`), so both features consume OpenAI API credits only when selected.

## Batch Auto-Mix

Turn on **Create one Auto-Mix from all videos** to keep the normal Opus-style recommendations and add a second output: one vertical montage assembled from moments across the full batch. Choose a 15, 30, 45, 60, or 90-second target and an editing rhythm: **Fast & Punchy**, **Smooth Story**, **Music Energy**, or **Clean Promo**. KlipPharma alternates sources, normalizes their video and audio, applies the batch watermark, and provides a playable MP4 above the individual klips. The finished duration can be shorter than the target when the uploaded footage does not contain enough usable time.

Before downloading, select **Review & edit Auto-Mix** to open the final sequence editor. Every selected moment can be previewed against its original source, trimmed with exact start/end times, moved earlier or later, removed, or given corrected caption wording. The editor also controls caption on/off, style, placement, watermark text, and watermark position for the entire Auto-Mix. **Rebuild & preview final Auto-Mix** renders the edited sequence while preserving the current MP4 until the replacement is complete. The final sequence remains limited to 90 seconds.

### Auto-Mix Audio Studio

The final editor includes a two-channel audio mixer for the original video sound and an uploaded music or effects track. Upload MP3, WAV, M4A, AAC, OGG, or FLAC, preview the track, replace it, or remove it without touching the source videos. Controls include:

- Original-video and added-sound volume from 0% to 150%
- Voice First, Balanced, Music Led, Added Sound Only, and Original Only presets
- Custom sound start time
- Loop to the end of the Auto-Mix
- Fade-in and fade-out duration
- Automatic music ducking while source dialogue is present

Audio is mixed locally during **Rebuild & preview final Auto-Mix**, so sound uploads and mixer changes do not use OpenAI credits.

## Caption and watermark studio

Every suggested klip includes a **Words & Watermark** panel. Creators can turn captions on or off, replace the transcript with the exact words they want, select Bold Social, Clean, KlipPharma Green, or Minimal styling, and place captions at the top, middle, or bottom. Caption and trim changes save automatically and are burned into the next vertical export.

Enter an optional default text watermark before uploading a batch, then change or remove it on any individual klip or inside the final Auto-Mix Editor. Watermarks can be placed in any corner and are also applied to an enabled Batch Auto-Mix. Version 0.13 ships text watermarks; uploaded logo/image watermarks remain a later brand-kit milestone.

## Saved projects

Completed project metadata, AI selections, adjusted timestamps, feedback, and download links are saved under `storage/projects/`. The **Recent Harvests** section restores completed work after KlipPharma restarts. Source videos and rendered exports remain under `storage/uploads/` and `storage/exports/`; preserve the full `storage/` directory when moving an installation.

See `FEATURE_ROADMAP.md` for the OpusClip-parity plan and the KlipPharma features intended to go beyond generic virality scoring.
