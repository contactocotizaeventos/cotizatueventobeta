/**
 * POST /api/admin-login
 *
 * Public endpoint — authenticates the admin user.
 * Compares credentials in constant time against env vars.
 * Returns a HMAC-SHA256 signed token valid for 8 hours.
 *
 * Environment variables required:
 *   ADMIN_USER, ADMIN_PASS, ADMIN_SECRET
 */

// ── Helpers ──────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(),
  });
}

function errorResponse(message, status = 500) {
  return jsonResponse({ ok: false, error: message }, status);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeEqual(a, b) {
  if (a.length !== b.length) {
    // Compare against self to maintain constant time even on length mismatch
    const dummy = new TextEncoder().encode(a);
    const dummyB = new TextEncoder().encode(a);
    crypto.subtle.timingSafeEqual?.(dummy, dummyB);
    return false;
  }
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(bufA, bufB);
  }
  // Fallback: manual constant-time comparison
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

/**
 * Create HMAC-SHA256 token: base64url(payload) + "." + base64url(signature)
 */
async function createToken(payload, secret) {
  const encoder = new TextEncoder();
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = btoa(payloadStr)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payloadB64)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${payloadB64}.${sigB64}`;
}

// ── Main handler ─────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context;

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method !== "POST") {
    return errorResponse("Método no permitido", 405);
  }

  if (!env.ADMIN_USER || !env.ADMIN_PASS || !env.ADMIN_SECRET) {
    console.error("Missing ADMIN_USER, ADMIN_PASS, or ADMIN_SECRET");
    return errorResponse("Error de configuración del servidor", 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("JSON inválido", 400);
  }

  const { user, password } = body;

  if (!user || !password) {
    return errorResponse("Usuario y contraseña son obligatorios", 400);
  }

  // ── Constant-time credential comparison ────────────────────────────
  const userOk = constantTimeEqual(user, env.ADMIN_USER);
  const passOk = constantTimeEqual(password, env.ADMIN_PASS);

  if (!userOk || !passOk) {
    return errorResponse("Credenciales inválidas", 401);
  }

  // ── Generate token ─────────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 28800; // 8 hours in seconds

  const payload = {
    sub: "admin",
    iat: now,
    exp: now + expiresIn,
  };

  try {
    const token = await createToken(payload, env.ADMIN_SECRET);
    return jsonResponse({ ok: true, token, expiresIn });
  } catch (err) {
    console.error("Error creating token:", err);
    return errorResponse("Error al generar token", 500);
  }
}
