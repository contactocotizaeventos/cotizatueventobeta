// netlify/functions/admin-manage.js
// Todas las operaciones protegidas del administrador:
//   GET    /admin-manage?action=solicitudes          → listar pendientes
//   GET    /admin-manage?action=proveedores          → listar todos los proveedores
//   POST   body { action:'aprobar', id }             → aprobar solicitud → crea proveedor
//   POST   body { action:'rechazar', id }            → rechazar y eliminar solicitud
//   PUT    body { action:'editar', id, fields:{} }   → editar proveedor
//   DELETE body { action:'eliminar', id }            → eliminar proveedor

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }

  // Verificar token en cada request
  const authError = verifyToken(event.headers['authorization']);
  if (authError) return respond(401, { error: authError });

  try {
    if (event.httpMethod === 'GET') {
      return await handleGet(event);
    }
    if (event.httpMethod === 'POST') {
      return await handlePost(event);
    }
    if (event.httpMethod === 'PUT') {
      return await handlePut(event);
    }
    if (event.httpMethod === 'DELETE') {
      return await handleDelete(event);
    }
    return respond(405, { error: 'Método no permitido' });
  } catch (err) {
    console.error('admin-manage error:', err);
    return respond(500, { error: err.message });
  }
};

// ── GET ────────────────────────────────────────────────
async function handleGet(event) {
  const action = event.queryStringParameters?.action;

  if (action === 'solicitudes') {
    const { data, error } = await supabase
      .from('solicitudes')
      .select('*')
      .order('fecha_registro', { ascending: false });
    if (error) throw error;
    return respond(200, { solicitudes: data });
  }

  if (action === 'proveedores') {
    const { data, error } = await supabase
      .from('proveedores')
      .select('*')
      .order('categoria', { ascending: true })
      .order('posicion', { ascending: true });
    if (error) throw error;
    return respond(200, { proveedores: data });
  }

  return respond(400, { error: 'Acción no reconocida' });
}

// ── POST (aprobar / rechazar) ──────────────────────────
async function handlePost(event) {
  const body = JSON.parse(event.body);
  const { action, id } = body;

  if (action === 'aprobar') {
    // 1. Obtener solicitud
    const { data: sol, error: solErr } = await supabase
      .from('solicitudes')
      .select('*')
      .eq('id', id)
      .single();
    if (solErr) throw solErr;

    // 2. Determinar posición (máx por categoría + 1, o usar posicion_deseada)
    const primaryCat = Array.isArray(sol.categorias) ? sol.categorias[0] : sol.categorias;
    const { data: existing } = await supabase
      .from('proveedores')
      .select('posicion')
      .eq('categoria', primaryCat)
      .order('posicion', { ascending: false })
      .limit(1);

    const nextPos = body.posicion || (existing?.[0]?.posicion ? existing[0].posicion + 1 : 4);

    // 3. Insertar en proveedores
    const { data: prov, error: provErr } = await supabase
      .from('proveedores')
      .insert([{
        nombre:        sol.nombre,
        responsable:   sol.responsable,
        descripcion:   sol.descripcion,
        diferenciador: sol.diferenciador,
        tagline:       sol.diferenciador,
        experiencia:   sol.experiencia,
        capacidad:     sol.capacidad,
        categoria:     primaryCat,
        comunas:       sol.comunas,
        precio_minimo: sol.precio_minimo,
        precio_maximo: sol.precio_maximo,
        incluye:       sol.incluye,
        no_incluye:    sol.no_incluye,
        whatsapp:      sol.whatsapp,
        telefono:      sol.telefono,
        email:         sol.email,
        web:           sol.web,
        instagram:     sol.instagram,
        facebook:      sol.facebook,
        tiktok:        sol.tiktok,
        youtube:       sol.youtube,
        logo_emoji:    sol.logo_emoji || '🍽️',
        logo_url:      sol.logo_url || '',
        cover_url:     sol.cover_url || '',
        posicion:      nextPos,
        activo:        true,
        solicitud_id:  sol.id,
        fecha_aprobacion: new Date().toISOString(),
      }])
      .select()
      .single();
    if (provErr) throw provErr;

    // 4. Actualizar estado de solicitud
    await supabase
      .from('solicitudes')
      .update({ estado: 'aprobada', proveedor_id: prov.id })
      .eq('id', id);

    return respond(200, { ok: true, proveedor: prov });
  }

  if (action === 'rechazar') {
    const { error } = await supabase
      .from('solicitudes')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return respond(200, { ok: true, message: 'Solicitud eliminada' });
  }

  return respond(400, { error: 'Acción no reconocida' });
}

// ── PUT (editar proveedor) ─────────────────────────────
async function handlePut(event) {
  const { id, fields } = JSON.parse(event.body);
  if (!id || !fields) return respond(400, { error: 'Faltan id o fields' });

  // Campos editables (whitelist de seguridad)
  const ALLOWED = [
    'nombre','tagline','descripcion','diferenciador','experiencia','capacidad',
    'categoria','comunas','precio_minimo','precio_maximo','incluye','no_incluye',
    'whatsapp','telefono','email','web','instagram','facebook','tiktok','youtube',
    'logo_emoji','logo_url','cover_url','posicion','activo',
  ];

  const sanitized = {};
  ALLOWED.forEach(k => {
    if (fields[k] !== undefined) sanitized[k] = fields[k];
  });

  const { data, error } = await supabase
    .from('proveedores')
    .update(sanitized)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;

  return respond(200, { ok: true, proveedor: data });
}

// ── DELETE (eliminar proveedor) ────────────────────────
async function handleDelete(event) {
  const { id } = JSON.parse(event.body);
  if (!id) return respond(400, { error: 'Falta id' });

  const { error } = await supabase
    .from('proveedores')
    .delete()
    .eq('id', id);
  if (error) throw error;

  return respond(200, { ok: true, message: 'Proveedor eliminado' });
}

// ── TOKEN VERIFICATION ─────────────────────────────────
function verifyToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return 'Token requerido';
  const token = authHeader.slice(7);
  const parts = token.split('.');
  if (parts.length !== 2) return 'Token inválido';

  const [payloadB64, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', process.env.ADMIN_SECRET)
    .update(payloadB64)
    .digest('hex');

  if (sig !== expectedSig) return 'Firma inválida';

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
    if (payload.exp < Date.now()) return 'Token expirado';
  } catch {
    return 'Token malformado';
  }

  return null; // ok
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}
