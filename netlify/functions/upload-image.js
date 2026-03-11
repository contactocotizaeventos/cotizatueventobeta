// netlify/functions/upload-image.js
// Recibe una imagen en base64 y la sube a Supabase Storage
// Devuelve la URL pública de la imagen

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BUCKET = 'portadas'; // Nombre del bucket en Supabase Storage
const MAX_SIZE_MB = 5;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Método no permitido' });
  }

  try {
    const { imageBase64, fileName, mimeType } = JSON.parse(event.body);

    if (!imageBase64 || !fileName || !mimeType) {
      return respond(400, { error: 'Faltan campos: imageBase64, fileName, mimeType' });
    }

    // Validar tipo de archivo
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(mimeType)) {
      return respond(400, { error: 'Tipo de archivo no permitido. Usa JPG, PNG o WebP.' });
    }

    // Convertir base64 a Buffer
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Validar tamaño
    const sizeMB = buffer.length / (1024 * 1024);
    if (sizeMB > MAX_SIZE_MB) {
      return respond(400, { error: `La imagen supera los ${MAX_SIZE_MB}MB permitidos.` });
    }

    // Generar nombre único para evitar colisiones
    const ext = fileName.split('.').pop().toLowerCase();
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const filePath = `proveedores/${uniqueName}`;

    // Subir a Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    // Obtener URL pública
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(filePath);

    return respond(200, {
      ok: true,
      url: urlData.publicUrl,
    });

  } catch (err) {
    console.error('upload-image error:', err);
    return respond(500, { error: 'Error al subir imagen', detail: err.message });
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
