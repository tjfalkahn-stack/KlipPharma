export function parseIncomingKlipdoseResponse(data) {
  if (!data || typeof data !== "object") throw new Error("Incoming Projects response was empty.");
  if (!Array.isArray(data.projects)) throw new Error("Incoming Projects response missing projects array.");
  if (!data.stats || typeof data.stats !== "object") throw new Error("Incoming Projects response missing stats.");
  return {
    projects: data.projects,
    stats: {
      new: Number(data.stats.new ?? 0),
      processing: Number(data.stats.processing ?? 0),
      ready: Number(data.stats.ready ?? 0),
      failed: Number(data.stats.failed ?? 0),
    },
  };
}
