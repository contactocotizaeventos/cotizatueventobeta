// netlify/functions/submit-form.js
// Recibe el formulario de registro de proveedor y lo guarda en Supabase

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Método no permitido' });
  }

  try {
    const body = JSON.parse(event.body);

    // Validación mínima
    if (!body.nombre || !body.whatsapp || !body.email) {
      return respond(400, { error: 'Faltan campos obligatorios: nombre, whatsapp, email' });
    }

    const { data, error } = await supabase
      .from('solicitudes')
      .insert([{
        nombre:          body.nombre,
        responsable:     body.responsable || '',
        rut:             body.rut || '',
        descripcion:     body.descripcion || '',
        diferenciador:   body.diferenciador || '',
        experiencia:     body.experiencia || '',
        capacidad:       body.capacidad || '',
        categorias:      body.categorias || [],        // array de strings
        comunas:         body.comunas || '',
        precio_minimo:   body.precio_minimo || '',
        precio_maximo:   body.precio_maximo || '',
        incluye:         body.incluye || '',
        no_incluye:      body.no_incluye || '',
        anticipacion:    body.anticipacion || '',
        anticipo:        body.anticipo || '',
        whatsapp:        body.whatsapp,
        telefono:        body.telefono || '',
        email:           body.email,
        web:             body.web || '',
        instagram:       body.instagram || '',
        facebook:        body.facebook || '',
        tiktok:          body.tiktok || '',
        youtube:         body.youtube || '',
        direccion:       body.direccion || '',
        posicion_deseada: body.posicion_deseada || '',
        logo_url:        body.logo_url || '',
        cover_url:       body.cover_url || '',
        logo_emoji:      body.logo_emoji || '🍽️',
        comentarios:     body.comentarios || '',
        estado:          'pendiente',
        fecha_registro:  new Date().toISOString(),
      }])
      .select()
      .single();

    if (error) throw error;

    return respond(200, { ok: true, id: data.id, message: 'Solicitud recibida correctamente' });

  } catch (err) {
    console.error('submit-form error:', err);
    return respond(500, { error: 'Error interno del servidor', detail: err.message });
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
