const terminalUploadStatuses = new Set(["failed", "cancelled"]);

export function batchSourcesSettled(group = [], session = null) {
  if (!Array.isArray(group) || !group.length) return false;

  const expectedFromProjects = Math.max(
    0,
    ...group.map((job) => Number(job?.batchSize || job?.montage?.sourceCount || 0)),
  );

  if (!session || !Array.isArray(session.files) || !session.files.length) {
    return group.length >= Math.max(1, expectedFromProjects);
  }

  const unresolvedUpload = session.files.some((file) => (
    !file?.projectId && !terminalUploadStatuses.has(String(file?.status || ""))
  ));
  if (unresolvedUpload) return false;

  const expectedProjects = session.files.filter((file) => !terminalUploadStatuses.has(String(file?.status || ""))).length;
  const projectIds = new Set(group.map((job) => String(job?.id || "")));
  const everyQueuedSourceExists = session.files.every((file) => (
    terminalUploadStatuses.has(String(file?.status || ""))
      || (file?.projectId && projectIds.has(String(file.projectId)))
  ));

  return everyQueuedSourceExists && group.length >= expectedProjects;
}

export function fitClipToRequestedLength(startValue, endValue, sourceDurationValue, requestedLengthValue) {
  const sourceDuration = Math.max(0, Number(sourceDurationValue) || 0);
  const requestedLength = Number(requestedLengthValue);
  let start = Math.max(0, Math.min(sourceDuration, Number(startValue) || 0));
  let end = Math.max(start, Math.min(sourceDuration, Number(endValue) || start));
  if (!Number.isFinite(requestedLength) || requestedLength <= 0 || sourceDuration <= 0) return { start, end };

  const target = Math.min(sourceDuration, requestedLength);
  if (end - start >= target) return { start, end: start + target };

  end = Math.min(sourceDuration, start + target);
  start = Math.max(0, end - target);
  return { start, end };
}

export function fitMontageSegmentToVideo(startValue, durationValue, videoDurationValue) {
  const videoDuration = Math.max(0, Number(videoDurationValue) || 0);
  const requestedDuration = Math.max(0, Number(durationValue) || 0);
  const duration = Math.min(requestedDuration, videoDuration);
  const latestStart = Math.max(0, videoDuration - duration);
  const start = Math.max(0, Math.min(Number(startValue) || 0, latestStart));
  return { start, duration };
}

export function takeMontageSegmentsRoundRobin(sourceQueues = [], targetDurationValue = 0) {
  const queues = (Array.isArray(sourceQueues) ? sourceQueues : [])
    .map((queue) => Array.isArray(queue) ? [...queue] : [])
    .filter((queue) => queue.length);
  const selected = [];
  let remaining = Math.max(0, Number(targetDurationValue) || 0);
  while (remaining >= 0.75 && queues.some((queue) => queue.length)) {
    let progressed = false;
    for (const queue of queues) {
      if (remaining < 0.75) break;
      const candidate = queue.shift();
      if (!candidate) continue;
      const duration = Math.min(Number(candidate.duration) || 0, remaining);
      if (duration < 0.75) continue;
      selected.push({ ...candidate, duration });
      remaining -= duration;
      progressed = true;
    }
    if (!progressed) break;
  }
  return selected;
}
