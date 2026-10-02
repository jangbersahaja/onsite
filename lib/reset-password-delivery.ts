const linkLifetimeMs = 30 * 60 * 1000;
const resetLinks = new Map<string, { url: string; expiresAt: number }>();

export function storeResetPasswordLink(requestId: string, url: string) {
  const now = Date.now();
  for (const [id, entry] of resetLinks) {
    if (entry.expiresAt <= now) resetLinks.delete(id);
  }
  resetLinks.set(requestId, { url, expiresAt: now + linkLifetimeMs });
}

export function takeResetPasswordLink(requestId: string) {
  const entry = resetLinks.get(requestId);
  resetLinks.delete(requestId);
  return entry && entry.expiresAt > Date.now() ? entry.url : null;
}
