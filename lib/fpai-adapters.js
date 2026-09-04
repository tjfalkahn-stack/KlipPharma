const adapters = [
  { id: "fpai_forge", name: "FPAI Forge", events: ["media.ingested", "clip.candidate_generated"] },
  { id: "fpai_relationship_engine", name: "FPAI Relationship Engine", events: ["klipper.joined", "participant.status_changed"] },
  { id: "fpai_growth_intelligence", name: "FPAI Growth Intelligence", events: ["performance.observation_recorded"] },
  { id: "fpai_voice_lock", name: "FPAI Voice Lock", events: ["clip.caption_package_saved"] },
  { id: "fpai_business_ip_ledger", name: "FPAI Business/IP Ledger", events: ["rights.acknowledged", "ledger.approved"] },
  { id: "fpai_report_studio", name: "FPAI Report Studio", events: ["campaign.analytics_snapshot"] },
  { id: "relay_go", name: "Relay Go", events: ["submission.created"] },
  { id: "creator_os", name: "Creator OS", events: ["campaign.created", "campaign.status"] },
  { id: "fpai_film_studio", name: "FPAI Film Studio", events: ["source.media_linked"] },
];

export function fpaiAdapterCatalog() {
  return adapters.map((adapter) => ({
    ...adapter,
    coupled: false,
    transport: "event_bus",
    status: "boundary_only",
    note: "KlipPharma emits named events. Unfinished Forge modules are not imported or required at runtime.",
  }));
}

export function createFpaiEventBus({ emit } = {}) {
  const listeners = new Map();
  return {
    catalog: fpaiAdapterCatalog(),
    on(eventName, handler) {
      const list = listeners.get(eventName) || [];
      list.push(handler);
      listeners.set(eventName, list);
    },
    async publish(eventName, payload) {
      const event = {
        eventName,
        payload,
        source: "klippharma.campaign_network",
        emittedAt: new Date().toISOString(),
      };
      if (emit) await emit(event);
      for (const handler of listeners.get(eventName) || []) await handler(event);
      return event;
    },
  };
}
