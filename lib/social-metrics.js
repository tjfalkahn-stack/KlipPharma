import { sanitizeMetrics } from "./campaign-submissions.js";

export class SocialMetricsProvider {
  constructor(name) {
    this.name = name;
  }
  health() {
    return { provider: this.name, status: "manual_only", officialApi: false };
  }
  async getProfile() {
    return { status: "manual_required", metrics: {}, evidence: { reason: "Official profile API not configured." } };
  }
  async getPublicPost() {
    return { status: "manual_required", metrics: {}, evidence: { reason: "Official post API not configured." }, provider: this.name };
  }
}

export class ManualEvidenceProvider extends SocialMetricsProvider {
  constructor() {
    super("manual");
  }
  health() {
    return { provider: this.name, status: "ready", officialApi: false, fallback: true };
  }
  async getPublicPost(_url, context = {}) {
    return {
      status: "manual_required",
      provider: this.name,
      metrics: {},
      evidence: {
        reason: "Manual verification/evidence is the v1 fallback. Reviewers attach observed metrics without scraping protected pages.",
        platform: context.platform || null,
      },
    };
  }
}

export class TikTokOfficialAdapter extends SocialMetricsProvider {
  constructor({ getConnection } = {}) {
    super("tiktok");
    this.getConnection = getConnection;
  }
  health() {
    return { provider: this.name, status: "configured_when_connected", officialApi: true, scraping: false };
  }
  async getPublicPost(_url, context = {}) {
    const connection = this.getConnection ? await this.getConnection("tiktok", context) : null;
    if (!connection?.accessToken) {
      return {
        status: "manual_required",
        provider: this.name,
        metrics: {},
        evidence: { reason: "TikTok official API is unavailable for this user. Use manual evidence. Protected data is not scraped." },
      };
    }
    return {
      status: "manual_required",
      provider: this.name,
      metrics: {},
      evidence: {
        reason: "TikTok Content Posting API does not grant arbitrary public-post scraping. Connected accounts can supply official stats when the platform allows it; otherwise reviewers use manual evidence.",
        connected: true,
      },
    };
  }
}

export class YouTubeOfficialAdapter extends SocialMetricsProvider {
  constructor({ getConnection } = {}) {
    super("youtube");
    this.getConnection = getConnection;
  }
  health() {
    return { provider: this.name, status: "configured_when_connected", officialApi: true, scraping: false };
  }
  async getPublicPost(_url, context = {}) {
    const connection = this.getConnection ? await this.getConnection("youtube", context) : null;
    if (!connection?.accessToken) {
      return {
        status: "manual_required",
        provider: this.name,
        metrics: {},
        evidence: { reason: "YouTube Data API is not connected for this user. Manual evidence is required. No scraping." },
      };
    }
    return {
      status: "manual_required",
      provider: this.name,
      metrics: {},
      evidence: {
        reason: "YouTube adapter is ready for official Data API lookups when a video id and authorized scopes are present. v1 still requires human verification.",
        connected: true,
      },
    };
  }
}

export class InstagramAdapter extends SocialMetricsProvider {
  constructor() { super("instagram"); }
}

export class XAdapter extends SocialMetricsProvider {
  constructor() { super("x"); }
}

export function createMetricsRegistry({ getConnection } = {}) {
  const providers = {
    manual: new ManualEvidenceProvider(),
    tiktok: new TikTokOfficialAdapter({ getConnection }),
    youtube: new YouTubeOfficialAdapter({ getConnection }),
    instagram: new InstagramAdapter(),
    x: new XAdapter(),
  };
  return {
    providers,
    health() {
      return Object.fromEntries(Object.entries(providers).map(([name, provider]) => [name, provider.health()]));
    },
    async getPublicPost(url, context = {}) {
      const provider = providers[context.platform] || providers.manual;
      const result = await provider.getPublicPost(url, context);
      if (result.metrics && Object.keys(result.metrics).length) {
        result.metrics = sanitizeMetrics({ ...result.metrics, source: provider.name });
      }
      return result;
    },
  };
}
