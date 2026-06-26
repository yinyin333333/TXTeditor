export function activeHoverQueueLength({ activeRequest = null, latestQueuedRequest = null } = {}) {
  return (activeRequest ? 1 : 0) + (latestQueuedRequest ? 1 : 0);
}

export function createUserHoverRequest({ target, generation, sample, queuedAt }) {
  return { target, generation, sample, queuedAt };
}

export function planUserHoverEnqueue({ hasPending = false, activeRequest = null, latestQueuedRequest = null } = {}) {
  if (hasPending) {
    return { action: "attach-pending", replaceLatest: false };
  }
  if (!activeRequest) {
    return { action: "dispatch", replaceLatest: false };
  }
  return {
    action: "queue-latest",
    replaceLatest: Boolean(latestQueuedRequest?.sample)
  };
}

export function takeLatestQueuedHover(latestQueuedRequest) {
  return {
    next: latestQueuedRequest ?? null,
    latestQueuedRequest: null
  };
}
