// netlify/functions/admin-login.js
// Login del administrador. Devuelve un token JWT firmado con ADMIN_SECRET.
// La contraseña NUNCA viaja al cliente ni está en el código frontend.

const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Método no permitido' });
  }

  try {
    const { usuario, password } = JSON.parse(event.body);

    const ADMIN_USER = process.env.ADMIN_USER;
    const ADMIN_PASS = process.env.ADMIN_PASS;
    const ADMIN_SECRET = process.env.ADMIN_SECRET; // clave para firmar tokens

    if (!ADMIN_USER || !ADMIN_PASS || !ADMIN_SECRET) {
      return respond(500, { error: 'Variables de entorno no configuradas' });
    }

    // Comparación segura (evita timing attacks)
    const userMatch = crypto.timingSafeEqual(
      Buffer.from(usuario || ''),
      Buffer.from(ADMIN_USER)
    );
    const passMatch = crypto.timingSafeEqual(
      Buffer.from(password || ''),
      Buffer.from(ADMIN_PASS)
    );

    if (!userMatch || !passMatch) {
      return respond(401, { error: 'Credenciales incorrectas' });
    }

    // Crear token simple: payload.signature (válido por 8 horas)
    const payload = {
      sub: 'admin',
      iat: Date.now(),
      exp: Date.now() + 8 * 60 * 60 * 1000,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    const sig = crypto
      .createHmac('sha256', ADMIN_SECRET)
      .update(payloadB64)
      .digest('hex');

    const token = `${payloadB64}.${sig}`;

    return respond(200, { ok: true, token, expiresIn: 8 * 3600 });

  } catch (err) {
    console.error('admin-login error:', err);
    return respond(500, { error: 'Error interno' });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}
