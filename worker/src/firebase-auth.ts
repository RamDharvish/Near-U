/**
 * Firebase ID Token verification using standard Web Crypto and Google public JWKS.
 * Zero external dependencies. Designed specifically for Cloudflare Workers Free.
 */

interface JWK {
  kty: string;
  alg: string;
  use: string;
  kid: string;
  n: string;
  e: string;
}

interface JWKSResponse {
  keys: JWK[];
}

export interface VerifiedFirebaseToken {
  uid: string;
  email?: string;
  auth_time: number;
  exp: number;
}

// In-memory JWKS cache
let cachedKeys: Map<string, CryptoKey> = new Map();
let cacheExpiresAt = 0;

function base64UrlDecode(str: string): Uint8Array {
  // Convert base64url to standard base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseJwtJson<T>(str: string): T {
  const bytes = base64UrlDecode(str);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

/**
 * Fetches and imports Google's public signing keys for Firebase ID tokens.
 */
async function getGooglePublicKeys(): Promise<Map<string, CryptoKey>> {
  const now = Date.now();
  if (cachedKeys.size > 0 && now < cacheExpiresAt) {
    return cachedKeys;
  }

  const res = await fetch(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch Google public JWKS: ${res.statusText}`);
  }

  // Parse Cache-Control header
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeSeconds = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
  cacheExpiresAt = now + maxAgeSeconds * 1000;

  const data = (await res.json()) as JWKSResponse;
  const newMap = new Map<string, CryptoKey>();

  for (const jwk of data.keys) {
    try {
      const cryptoKey = await crypto.subtle.importKey(
        'jwk',
        jwk,
        {
          name: 'RSASSA-PKCS1-v1_5',
          hash: 'SHA-256',
        },
        false,
        ['verify']
      );
      newMap.set(jwk.kid, cryptoKey);
    } catch {
      // Ignore unsupported key types
    }
  }

  cachedKeys = newMap;
  return newMap;
}

/**
 * Verifies a Firebase ID token sent in Authorization: Bearer <token>.
 * Guarantees that the sender UID comes from Google Auth and has not been forged.
 */
export async function verifyFirebaseIdToken(
  token: string,
  firebaseProjectId: string
): Promise<VerifiedFirebaseToken> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Parse Header
  interface JwtHeader {
    alg: string;
    kid?: string;
  }
  const header = parseJwtJson<JwtHeader>(headerB64);
  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Invalid JWT algorithm or missing kid in header');
  }

  // 2. Obtain matching Google public key
  const keys = await getGooglePublicKeys();
  const publicKey = keys.get(header.kid);
  if (!publicKey) {
    throw new Error('No matching Google public key found for kid: ' + header.kid);
  }

  // 3. Verify Signature
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = base64UrlDecode(signatureB64);

  const isValidSignature = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    signatureBytes as unknown as BufferSource,
    signedData as unknown as BufferSource
  );

  if (!isValidSignature) {
    throw new Error('Invalid JWT signature');
  }

  // 4. Validate Claims
  interface JwtPayload {
    aud: string;
    iss: string;
    sub: string;
    exp: number;
    auth_time: number;
    email?: string;
  }
  const payload = parseJwtJson<JwtPayload>(payloadB64);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (payload.aud !== firebaseProjectId) {
    throw new Error(`Invalid audience: expected ${firebaseProjectId}, got ${payload.aud}`);
  }

  const expectedIssuer = `https://securetoken.google.com/${firebaseProjectId}`;
  if (payload.iss !== expectedIssuer) {
    throw new Error(`Invalid issuer: expected ${expectedIssuer}, got ${payload.iss}`);
  }

  if (payload.exp < nowSeconds) {
    throw new Error('Token has expired');
  }

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Missing sub claim in token');
  }

  return {
    uid: payload.sub,
    email: payload.email,
    auth_time: payload.auth_time,
    exp: payload.exp,
  };
}
