/**
 * Expo Push Notification Service Client.
 * Delivers push notifications via https://exp.host/--/api/v2/push/send
 * and processes receipts via https://exp.host/--/api/v2/push/getReceipts.
 * Zero paid dependencies. 100% free tier.
 */

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  channelId: string;
  priority: 'default' | 'normal' | 'high';
  sound: 'default' | null;
}

export type ExpoTicketErrorCode =
  | 'DeviceNotRegistered'
  | 'InvalidCredentials'
  | 'MessageTooBig'
  | 'MessageRateExceeded'
  | string;

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: {
    error?: ExpoTicketErrorCode;
    fault?: 'developer' | 'server';
    [key: string]: unknown;
  };
}

export interface PushDeliveryError {
  code: string;
  message: string;
}

export interface SuccessfulTicketRecord {
  ticketId: string;
  token: string;
}

export interface SendPushResult {
  totalAttempted: number;
  totalSuccessful: number;
  tickets: ExpoPushTicket[];
  successfulTickets: SuccessfulTicketRecord[];
  unregisteredTokens: string[];
  errors: PushDeliveryError[];
}

export interface ExpoPushReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: {
    error?: string;
    fault?: 'developer' | 'server';
    [key: string]: unknown;
  };
}

export interface ProcessReceiptsResult {
  checkedCount: number;
  confirmedDelivered: string[];
  unregisteredTokens: string[];
  receiptErrors: Array<{ ticketId: string; code: string; message: string }>;
  pendingTicketIds: string[];
}

// Expo Push API maximum messages per batch
export const EXPO_PUSH_MAX_BATCH_SIZE = 100;
// Expo Receipt API maximum ticket IDs per batch
export const EXPO_RECEIPT_MAX_BATCH_SIZE = 300;

/**
 * Sends notifications via Expo Push API with individual message objects per token.
 * Respects Expo's 100-message batch limit and maps returned tickets 1:1 to tokens.
 */
export async function sendExpoPushNotifications(
  tokens: string[],
  payload: {
    message: string;
    type: 'standard' | 'long_press';
    eventId: string;
    fromUid: string;
    fromName?: string;
  }
): Promise<SendPushResult> {
  if (tokens.length === 0) {
    return {
      totalAttempted: 0,
      totalSuccessful: 0,
      tickets: [],
      successfulTickets: [],
      unregisteredTokens: [],
      errors: [],
    };
  }

  const channelId = payload.type === 'long_press' ? 'long_press_nearu' : 'standard_nearu';
  const notificationTitle = payload.fromName ? `${payload.fromName} · Near-U` : 'Near-U 💙';

  const allTickets: ExpoPushTicket[] = [];
  const successfulTickets: SuccessfulTicketRecord[] = [];
  const unregisteredTokens: string[] = [];
  const detectedErrors: PushDeliveryError[] = [];
  let totalSuccessful = 0;

  // Chunk tokens into batches of up to EXPO_PUSH_MAX_BATCH_SIZE
  for (let i = 0; i < tokens.length; i += EXPO_PUSH_MAX_BATCH_SIZE) {
    const batchTokens = tokens.slice(i, i + EXPO_PUSH_MAX_BATCH_SIZE);

    // Build one individual message object per recipient token to guarantee 1:1 ticket indexing
    const messages: ExpoPushMessage[] = batchTokens.map((token) => ({
      to: token,
      title: notificationTitle,
      body: payload.message,
      data: {
        eventId: payload.eventId,
        type: payload.type,
        fromUid: payload.fromUid,
        fromName: payload.fromName,
        message: payload.message,
      },
      channelId,
      priority: 'high',
      sound: 'default',
    }));

    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      const errorText = await res.text();
      detectedErrors.push({
        code: `HTTP_${res.status}`,
        message: `Expo Push API HTTP ${res.status}: ${errorText.slice(0, 200)}`,
      });
      continue;
    }

    interface ExpoApiResponse {
      data?: ExpoPushTicket[];
      errors?: Array<{ code: string; message: string }>;
    }

    let responseJson: ExpoApiResponse;
    try {
      if (typeof res.text === 'function') {
        const text = await res.text();
        if (typeof text !== 'string' || !text.trim()) {
          detectedErrors.push({
            code: 'EMPTY_RESPONSE',
            message: 'Expo Push API returned empty response body',
          });
          continue;
        }
        responseJson = JSON.parse(text) as ExpoApiResponse;
      } else if (typeof res.json === 'function') {
        responseJson = (await res.json()) as ExpoApiResponse;
      } else {
        detectedErrors.push({
          code: 'MALFORMED_RESPONSE',
          message: 'Expo Push API response has no readable body',
        });
        continue;
      }
    } catch {
      detectedErrors.push({
        code: 'INVALID_JSON',
        message: 'Expo Push API returned non-JSON response',
      });
      continue;
    }

    if (!responseJson || typeof responseJson !== 'object') {
      detectedErrors.push({
        code: 'MALFORMED_RESPONSE',
        message: 'Expo Push API response is not a valid JSON object',
      });
      continue;
    }

    if (Array.isArray(responseJson.errors)) {
      for (const err of responseJson.errors) {
        detectedErrors.push({
          code: err.code || 'EXPO_API_ERROR',
          message: err.message || 'Expo API returned top-level error',
        });
      }
    }

    if (!Array.isArray(responseJson.data)) {
      detectedErrors.push({
        code: 'MISSING_DATA',
        message: 'Expo Push API response missing tickets array',
      });
      continue;
    }

    const tickets = responseJson.data;

    // Map each ticket 1:1 with the original token in this batch
    batchTokens.forEach((token, idx) => {
      const ticket = tickets[idx];
      if (!ticket || typeof ticket !== 'object') {
        detectedErrors.push({
          code: 'MISSING_TICKET',
          message: 'Expo ticket response missing for recipient token',
        });
        return;
      }

      allTickets.push(ticket);

      if (ticket.status === 'ok') {
        totalSuccessful++;
        if (ticket.id && token) {
          successfulTickets.push({ ticketId: ticket.id, token });
        }
      } else if (ticket.status === 'error') {
        const errorCode = ticket.details?.error || 'Unknown';

        if (errorCode === 'DeviceNotRegistered') {
          if (token) {
            unregisteredTokens.push(token);
          }
        } else if (errorCode === 'InvalidCredentials') {
          console.error('[Worker Push] Expo delivery error: InvalidCredentials. FCM V1 server credentials missing or invalid in Expo project.');
          detectedErrors.push({
            code: 'InvalidCredentials',
            message: 'Expo push credentials invalid or missing FCM V1 key.',
          });
        } else if (errorCode === 'MessageTooBig') {
          console.error('[Worker Push] Expo delivery error: MessageTooBig. Notification payload size exceeds limits.');
          detectedErrors.push({
            code: 'MessageTooBig',
            message: 'Notification payload size exceeds Expo limit.',
          });
        } else if (errorCode === 'MessageRateExceeded') {
          console.warn('[Worker Push] Expo delivery warning: MessageRateExceeded. Upstream rate limit reached.');
          detectedErrors.push({
            code: 'MessageRateExceeded',
            message: 'Push rate limit exceeded on upstream provider.',
          });
        } else {
          console.warn(`[Worker Push] Expo ticket delivery error: ${errorCode}`);
          detectedErrors.push({
            code: errorCode,
            message: ticket.message || 'Push ticket delivery failed.',
          });
        }
      }
    });
  }

  return {
    totalAttempted: tokens.length,
    totalSuccessful,
    tickets: allTickets,
    successfulTickets,
    unregisteredTokens,
    errors: detectedErrors,
  };
}

/**
 * Retrieves push receipts from Expo Push API for previously queued notifications.
 * Preserves ticket IDs and maps receipts back to their corresponding tokens.
 */
export async function fetchExpoPushReceipts(
  ticketRecords: Array<{ ticketId: string; token: string }>
): Promise<ProcessReceiptsResult> {
  if (ticketRecords.length === 0) {
    return {
      checkedCount: 0,
      confirmedDelivered: [],
      unregisteredTokens: [],
      receiptErrors: [],
      pendingTicketIds: [],
    };
  }

  const confirmedDelivered: string[] = [];
  const unregisteredTokens: string[] = [];
  const receiptErrors: Array<{ ticketId: string; code: string; message: string }> = [];
  const pendingTicketIds: string[] = [];

  // Chunk receipt requests into batches of up to EXPO_RECEIPT_MAX_BATCH_SIZE
  for (let i = 0; i < ticketRecords.length; i += EXPO_RECEIPT_MAX_BATCH_SIZE) {
    const batch = ticketRecords.slice(i, i + EXPO_RECEIPT_MAX_BATCH_SIZE);
    const ids = batch.map((r) => r.ticketId);

    const res = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify({ ids }),
    });

    if (!res.ok) {
      console.warn(`[Worker Push] Receipt check HTTP ${res.status}`);
      // Mark all in this batch as pending so they can be re-queried later
      for (const rec of batch) {
        pendingTicketIds.push(rec.ticketId);
      }
      continue;
    }

    interface ExpoReceiptsApiResponse {
      data?: Record<string, ExpoPushReceipt>;
    }

    let responseJson: ExpoReceiptsApiResponse;
    try {
      if (typeof res.text === 'function') {
        const text = await res.text();
        if (typeof text !== 'string' || !text.trim()) {
          console.warn('[Worker Push] Receipt check returned empty response');
          for (const rec of batch) {
            pendingTicketIds.push(rec.ticketId);
          }
          continue;
        }
        responseJson = JSON.parse(text) as ExpoReceiptsApiResponse;
      } else if (typeof res.json === 'function') {
        responseJson = (await res.json()) as ExpoReceiptsApiResponse;
      } else {
        for (const rec of batch) {
          pendingTicketIds.push(rec.ticketId);
        }
        continue;
      }
    } catch {
      console.warn('[Worker Push] Receipt check returned non-JSON response');
      // Treat uncertain receipt results as pending so they can be safely retried
      for (const rec of batch) {
        pendingTicketIds.push(rec.ticketId);
      }
      continue;
    }

    if (!responseJson || typeof responseJson !== 'object' || !responseJson.data || typeof responseJson.data !== 'object') {
      console.warn('[Worker Push] Receipt check returned unexpected structure');
      for (const rec of batch) {
        pendingTicketIds.push(rec.ticketId);
      }
      continue;
    }

    const receiptsData = responseJson.data;

    for (const rec of batch) {
      const receipt = receiptsData[rec.ticketId];

      if (!receipt || typeof receipt !== 'object') {
        // Receipt is not ready yet or invalid; keep in pending queue for safe retry
        pendingTicketIds.push(rec.ticketId);
        continue;
      }

      if (receipt.status === 'ok') {
        confirmedDelivered.push(rec.ticketId);
      } else if (receipt.status === 'error') {
        const errCode = receipt.details?.error || 'Unknown';

        if (errCode === 'DeviceNotRegistered') {
          unregisteredTokens.push(rec.token);
        }

        receiptErrors.push({
          ticketId: rec.ticketId,
          code: errCode,
          message: receipt.message || 'Delivery error reported by provider',
        });
      }
    }
  }

  return {
    checkedCount: ticketRecords.length,
    confirmedDelivered,
    unregisteredTokens,
    receiptErrors,
    pendingTicketIds,
  };
}

