/**
 * POST /api/upload-image
 *
 * Public endpoint — no authentication required.
 * Accepts an image via multipart/form-data or JSON with base64 data.
 * Validates file type and size, then uploads to Supabase Storage bucket "portadas".
 *
 * Supported types: jpg, jpeg, png, webp, heic, heif
 * Max size: 50 MB
 *
 * Returns: { ok: true, url: "<public URL>" }
 */

import { createClient } from "@supabase/supabase-js";

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

const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * Generate a unique filename: proveedores/<timestamp>-<random>.<ext>
 */
function generateFilename(ext) {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 10);
  return `proveedores/${ts}-${rand}.${ext}`;
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

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    return errorResponse("Error de configuración del servidor", 500);
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  const contentType = request.headers.get("Content-Type") || "";

  let fileBuffer;
  let mimeType;
  let ext;

  try {
    // ── Mode 1: multipart/form-data ──────────────────────────────────
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");

      if (!file || typeof file === "string") {
        return errorResponse("No se encontró el archivo en el formulario", 400);
      }

      mimeType = file.type.toLowerCase();
      ext = ALLOWED_TYPES[mimeType];

      if (!ext) {
        return errorResponse(
          `Tipo de archivo no permitido: ${mimeType}. Usa JPG, PNG, WebP o HEIC.`,
          400
        );
      }

      if (file.size > MAX_SIZE) {
        return errorResponse("El archivo excede el límite de 50 MB", 400);
      }

      fileBuffer = await file.arrayBuffer();

    // ── Mode 2: JSON with base64 ─────────────────────────────────────
    } else if (contentType.includes("application/json")) {
      const body = await request.json();

      if (!body.data || !body.mime) {
        return errorResponse("Se requieren los campos 'data' (base64) y 'mime'", 400);
      }

      mimeType = body.mime.toLowerCase();
      ext = ALLOWED_TYPES[mimeType];

      if (!ext) {
        return errorResponse(
          `Tipo de archivo no permitido: ${mimeType}. Usa JPG, PNG, WebP o HEIC.`,
          400
        );
      }

      // Decode base64
      const raw = body.data.includes(",") ? body.data.split(",")[1] : body.data;

      try {
        const binaryString = atob(raw);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        fileBuffer = bytes.buffer;
      } catch {
        return errorResponse("Error al decodificar base64", 400);
      }

      if (fileBuffer.byteLength > MAX_SIZE) {
        return errorResponse("El archivo excede el límite de 50 MB", 400);
      }

    } else {
      return errorResponse(
        "Content-Type no soportado. Usa multipart/form-data o application/json.",
        400
      );
    }

    // ── HEIC/HEIF normalization note ─────────────────────────────────
    // Cloudflare Workers don't support native image conversion.
    // HEIC/HEIF files are uploaded as-is. If server-side conversion is
    // needed, it should be done via a separate service or Cloudflare Images.
    // For now, we accept them and let the frontend handle display.
    // If the type is heic/heif, we still upload but note the limitation.

    // ── Upload to Supabase Storage ───────────────────────────────────
    const filename = generateFilename(ext);

    const { error: uploadError } = await supabase.storage
      .from("portadas")
      .upload(filename, fileBuffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase Storage upload error:", uploadError);
      return errorResponse("Error al subir la imagen", 500);
    }

    // ── Get public URL ───────────────────────────────────────────────
    const { data: urlData } = supabase.storage
      .from("portadas")
      .getPublicUrl(filename);

    if (!urlData || !urlData.publicUrl) {
      return errorResponse("Error al obtener URL pública de la imagen", 500);
    }

    return jsonResponse({ ok: true, url: urlData.publicUrl });
  } catch (err) {
    console.error("Unexpected error in upload-image:", err);
    return errorResponse("Error interno del servidor", 500);
  }
}
