# KlipPharma

Current release: **v0.20.0 · Multilingual studio + creator-owned YouTube import**

KlipPharma turns long-form video into ranked, captioned vertical clips and can also assemble a batch into one CapCut-style Auto-Mix. The night-studio workspace supports mixed AI/manual batch uploads, creator-specific editorial modes, owner-authorized YouTube importing, multilingual transcription, translated captions and optional AI-dubbed audio, audience-aware clip scoring, browser-safe previews, adjustable start/end points, editable captions and watermarks, saved project history, feedback, and downloadable 9:16 MP4 exports.

**We pick the dopest klips!**

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

## Importing your own YouTube uploads

The source step accepts one public or unlisted YouTube video at a time. The creator must confirm that they own the video or have permission to download and edit it. KlipPharma rejects playlists, live streams, private, paid, age-restricted, account-only, and protected videos. Imported sources are capped at four hours and 1 GB.

The Docker image installs the pinned yt-dlp runtime automatically. For local Mac development, install it once and restart KlipPharma:

```bash
brew install yt-dlp
```

Set `YT_DLP_PATH` only when the executable is not available as `yt-dlp` on the server PATH. Once the source download completes, the processing screen exposes **Download source MP4** while KlipPharma continues into AI transcription or the manual cutter. YouTube may still require creators to use the official Studio download for restricted uploads.

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
