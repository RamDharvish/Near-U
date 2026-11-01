/**
 * Distributed rate limiting and duplicate event prevention for Cloudflare Workers.
 *
 * Architecture:
 * 1. Edge Coordination: Uses the Cloudflare Cache API (`caches.default`) to share
 *    rate limit cooldowns and deduplication records across Worker isolates within
 *    the edge data center at zero cost (no 1,000 writes/day KV limit).
 * 2. Isolate In-Memory Fast Path: Provides sub-millisecond local lookups within the same isolate.
 * 3. Environment Fallback: If `caches.default` is undefined (e.g. in Node.js test runner),
 *    falls back seamlessly to in-memory maps.
 * 4. Atomic Deduplication: Backed up by Firestore's transactional document creation (409 Conflict),
 *    which guarantees globally consistent duplicate suppression across all regions.
 */

interface SendHistoryEntry {
  timestamp: number;
}

declare global {
  interface CacheStorage {
    default?: Cache;
  }
}

const isolateSendHistory = new Map<string, SendHistoryEntry>();
const isolateProcessedEventIds = new Map<string, number>();

const SEND_COOLDOWN_MS = 5000; // 5-second cooldown per friend pair
const EVENT_DEDUP_WINDOW_MS = 60000; // 60-second duplicate event rejection window

export interface RateLimitResult {
  allowed: boolean;
  waitSeconds?: number;
}

/**
 * Checks whether an event was already processed.
 * Checks edge cache first, then isolate memory.
 */
export async function isDuplicateEvent(eventId: string): Promise<boolean> {
  cleanupStaleEntries();

  // 1. Fast path: check local isolate memory
  if (isolateProcessedEventIds.has(eventId)) {
    return true;
  }

  // 2. Check Cloudflare Cache API (shared across Worker isolates in same edge PoP)
  if (typeof caches !== 'undefined' && caches.default) {
    try {
      const cache = caches.default as Cache;
      const cacheKey = new Request(
        `https://rate-limit.nearu.internal/dedup/${encodeURIComponent(eventId)}`
      );
      const matched = await cache.match(cacheKey);
      if (matched) {
        isolateProcessedEventIds.set(eventId, Date.now());
        return true;
      }

      // Record in edge cache with 60s TTL
      const cacheResponse = new Response('1', {
        headers: {
          'Cache-Control': 'public, max-age=60',
          'Content-Type': 'text/plain',
        },
      });
      await cache.put(cacheKey, cacheResponse);
    } catch {
      // Cache API failure fallback to in-memory
    }
  }

  isolateProcessedEventIds.set(eventId, Date.now());
  return false;
}

/**
 * Checks if the sender is sending too frequently to the recipient.
 * Checks edge cache first, then isolate memory.
 */
export async function checkRateLimit(
  senderUid: string,
  recipientUid: string
): Promise<RateLimitResult> {
  cleanupStaleEntries();
  const key = `${senderUid}_${recipientUid}`;
  const now = Date.now();

  // 1. Fast path: check local isolate memory
  const lastEntry = isolateSendHistory.get(key);
  if (lastEntry) {
    const elapsed = now - lastEntry.timestamp;
    if (elapsed < SEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((SEND_COOLDOWN_MS - elapsed) / 1000);
      return { allowed: false, waitSeconds };
    }
  }

  // 2. Check Cloudflare Cache API (shared across isolates in same edge PoP)
  if (typeof caches !== 'undefined' && caches.default) {
    try {
      const cache = caches.default as Cache;
      const cacheKey = new Request(
        `https://rate-limit.nearu.internal/cooldown/${encodeURIComponent(key)}`
      );
      const matched = await cache.match(cacheKey);

      if (matched) {
        const timestampHeader = matched.headers.get('X-Sent-Timestamp');
        const timestamp = timestampHeader ? parseInt(timestampHeader, 10) : now;
        const elapsed = now - timestamp;
        const remaining = Math.max(1, Math.ceil((SEND_COOLDOWN_MS - elapsed) / 1000));
        return { allowed: false, waitSeconds: remaining };
      }

      // Record in edge cache with 5s TTL
      const cacheResponse = new Response('1', {
        headers: {
          'Cache-Control': 'public, max-age=5',
          'X-Sent-Timestamp': now.toString(),
          'Content-Type': 'text/plain',
        },
      });
      await cache.put(cacheKey, cacheResponse);
    } catch {
      // Cache API failure fallback to in-memory
    }
  }

  isolateSendHistory.set(key, { timestamp: now });
  return { allowed: true };
}

function cleanupStaleEntries(): void {
  const now = Date.now();
  if (isolateProcessedEventIds.size > 2000) {
    for (const [id, ts] of isolateProcessedEventIds.entries()) {
      if (now - ts > EVENT_DEDUP_WINDOW_MS) {
        isolateProcessedEventIds.delete(id);
      }
    }
  }

  if (isolateSendHistory.size > 2000) {
    for (const [key, entry] of isolateSendHistory.entries()) {
      if (now - entry.timestamp > SEND_COOLDOWN_MS * 2) {
        isolateSendHistory.delete(key);
      }
    }
  }
}
