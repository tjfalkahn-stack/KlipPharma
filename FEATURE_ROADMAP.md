# KlipPharma product roadmap

The goal is feature parity with a serious AI clipping editor, then differentiation through personalized editorial judgment. Items below are product work—not claims about what the current private beta already ships.

## Shipped foundation

- Local upload and cumulative batches of up to 10 video/audio files
- Per-file **AI + captions** or **Manual · no transcript** processing
- Artist/Music, Podcast/Interview, Monologue/Talking Head, and Smart Detect editorial modes
- Batch-wide Smart/15/30/45/60/90-second AI Auto-Klip recipes with editable results
- Optional 15/30/45/60/90-second multi-source Batch Auto-Mix with four editing rhythms
- Final Auto-Mix sequence editor with source preview, precise trims, reorder, remove, per-moment caption correction, and rebuild
- Final Auto-Mix audio mixer with sound uploads, two-channel volume, presets, start offset, looping, fades, and dialogue ducking
- Timestamped transcription, ranked clip recommendations, six-factor scoring, and reasons for every selection
- Browser-safe source previews, exact start/end controls, and a 90-second maximum
- Editable caption words, caption on/off, four text styles, three placements, and per-klip text watermarks
- 9:16 captioned MP4 rendering, downloads, saved projects, and good/almost/bad/wrong-topic feedback
- Optional PostgreSQL-backed creator accounts, secure sessions, and private project/export ownership with a zero-configuration local-owner fallback
- Optional owner-scoped Cloudflare R2 direct uploads with short-lived presigned URLs and automatic local fallback

## Editor parity

- Transcript-based text editing with word-level deletion and filler removal
- Timeline with waveform, thumbnails, split, trim, reorder, undo, and safe-zone overlays
- Reframing modes for 9:16, 1:1, and 16:9 with face/active-speaker tracking
- Advanced caption themes with per-word emphasis, custom fonts/colors, animation, and safe-zone guides
- Brand kits with image logos, fonts, colors, reusable intros/outros, CTA overlays, and templates
- B-roll, images, music, transitions, text overlays, audio cleanup, and volume controls
- Multiple export presets plus SRT/VTT and Premiere/DaVinci timeline exports

## KlipPharma judgment advantage

- A creator taste profile learned from accepted, adjusted, rejected, and posted clips
- Separate hook, context, payoff, retention, audience, platform, brand, and repurposing scores
- Visible reasons a clip was selected and explicit reasons candidates were rejected
- Missing-context and cut-too-early warnings before export
- Strategy lanes for educational, emotional, controversial, promotional, and objection-handling clips
- Prompted discovery such as “find the strongest customer objection” or “find every clean punchline”
- Hook variants, context repair, title/caption/description variants, and cross-format repurposing
- Performance feedback from published clips to improve future selections for that creator

## Workspace and distribution parity

- Organizations, project folders, roles, comments, approvals, and shared brand kits
- YouTube/Drive/Dropbox/Zoom/Riverside/URL imports plus watched-channel auto-import
- Social scheduling and publishing for supported TikTok, Reels, Shorts, LinkedIn, and X workflows
- Content calendar, platform-specific copy, analytics, experiments, and performance history
- API, webhooks, Zapier-style automation, batch processing, and reusable workflow presets
- Responsive/mobile review, editing, approval, and one-tap sharing

## Build order

1. Make preview, rendering, storage, and failure recovery production-reliable.
2. Build the real timeline/transcript/caption editor and reusable brand kits.
3. Extend shipped accounts with teams, cloud object storage, a durable job queue, and billing.
4. Add publishing, scheduling, analytics, and performance learning.
5. Add imports, API/webhooks, automation, and mobile workflows.

The next major product milestone is the editor: preview plus transcript/timeline editing, reframing, caption styles, and brand templates in one workspace.
