/**
 * POST /api/submit-form
 *
 * Public endpoint — no authentication required.
 * Receives a provider registration request, validates required fields,
 * inserts into the `solicitudes` table, and sends a confirmation email (Email 1).
 *
 * Supabase tables used (existing, do NOT modify):
 *   - solicitudes
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

/**
 * sendEmail — utility to send transactional emails via Resend API.
 * Never blocks the main operation if it fails.
 */
async function sendEmail(to, subject, html, env) {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [to],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Resend error (${res.status}):`, body);
    }
  } catch (err) {
    console.error("sendEmail failed:", err);
  }
}

/**
 * buildConfirmationEmail — Email 1: Confirmation that the request was received.
 */
function buildConfirmationEmail(nombre) {
  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#FAFAF8;padding:32px 16px;color:#1A1714;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:14px;padding:40px 32px;border:1px solid #E8E4DF;">
    <h1 style="font-size:22px;margin:0 0 8px 0;color:#E8542A;">CotizaEventos.cl</h1>
    <h2 style="font-size:18px;margin:0 0 24px 0;color:#1A1714;">¡Recibimos tu solicitud!</h2>
    <p style="margin:0 0 16px 0;line-height:1.6;color:#3D3733;">
      Hola${nombre ? ` <strong>${nombre}</strong>` : ""},
    </p>
    <p style="margin:0 0 16px 0;line-height:1.6;color:#3D3733;">
      Tu solicitud de registro en <strong>CotizaEventos.cl</strong> fue recibida exitosamente.
    </p>
    <p style="margin:0 0 16px 0;line-height:1.6;color:#3D3733;">
      En un plazo máximo de <strong>48 horas hábiles</strong> revisaremos tu información. La admisión no es automática — evaluamos cada solicitud para garantizar la calidad del directorio y la mejor experiencia para los clientes.
    </p>
    <p style="margin:0 0 16px 0;line-height:1.6;color:#3D3733;">
      Te notificaremos por correo electrónico cuando tu solicitud sea revisada.
    </p>
    <p style="margin:0 0 24px 0;line-height:1.6;color:#3D3733;">
      Si tienes dudas, escríbenos por WhatsApp:
    </p>
    <a href="https://wa.me/56991999301" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">
      💬 Contactar por WhatsApp
    </a>
    <hr style="border:none;border-top:1px solid #E8E4DF;margin:32px 0 16px 0;">
    <p style="margin:0;font-size:12px;color:#8A8278;">
      Este correo fue enviado automáticamente por CotizaEventos.cl
    </p>
  </div>
</body>
</html>`.trim();
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

  // Validate environment
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    return errorResponse("Error de configuración del servidor", 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("JSON inválido", 400);
  }

  // ── Validate required fields ───────────────────────────────────────
  const { nombre, whatsapp, email } = body;

  if (!nombre || !nombre.trim()) {
    return errorResponse("El nombre del negocio es obligatorio", 400);
  }
  if (!whatsapp || !whatsapp.trim()) {
    return errorResponse("El WhatsApp es obligatorio", 400);
  }
  if (!email || !email.trim()) {
    return errorResponse("El email es obligatorio", 400);
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  try {
    // ── Build solicitud record ─────────────────────────────────────────
    const solicitud = {
      nombre: (body.nombre || "").trim(),
      responsable: (body.responsable || "").trim(),
      rut: (body.rut || "").trim(),
      descripcion: (body.descripcion || "").trim(),
      diferenciador: (body.diferenciador || "").trim(),
      experiencia: (body.experiencia || "").trim(),
      capacidad: (body.capacidad || "").trim(),
      categorias: body.categorias || [],
      comunas: (body.comunas || "").trim(),
      precio_minimo: (body.precio_minimo || "").trim(),
      precio_maximo: (body.precio_maximo || "").trim(),
      incluye: (body.incluye || "").trim(),
      no_incluye: (body.no_incluye || "").trim(),
      anticipacion: (body.anticipacion || "").trim(),
      anticipo: (body.anticipo || "").trim(),
      whatsapp: (body.whatsapp || "").trim(),
      telefono: (body.telefono || "").trim(),
      email: (body.email || "").trim().toLowerCase(),
      web: (body.web || "").trim(),
      instagram: (body.instagram || "").trim(),
      facebook: (body.facebook || "").trim(),
      tiktok: (body.tiktok || "").trim(),
      youtube: (body.youtube || "").trim(),
      direccion: (body.direccion || "").trim(),
      posicion_deseada: body.posicion_deseada || "0",
      logo_url: (body.logo_url || "").trim(),
      cover_url: (body.cover_url || "").trim(),
      logo_emoji: (body.logo_emoji || "").trim(),
      comentarios: (body.comentarios || "").trim(),
      estado: "pendiente",
      fecha_registro: new Date().toISOString(),
    };

    // ── Insert into solicitudes ────────────────────────────────────────
    const { data, error } = await supabase
      .from("solicitudes")
      .insert([solicitud])
      .select("id")
      .single();

    if (error) {
      console.error("Error inserting solicitud:", error);
      return errorResponse("Error al guardar la solicitud", 500);
    }

    // ── Send Email 1 (non-blocking) ────────────────────────────────────
    if (env.RESEND_API_KEY && env.EMAIL_FROM) {
      const emailHtml = buildConfirmationEmail(solicitud.nombre);
      // Fire and forget — do NOT await blocking
      sendEmail(solicitud.email, "Tu solicitud en CotizaEventos.cl fue recibida", emailHtml, env);
    }

    return jsonResponse({ ok: true, id: data.id });
  } catch (err) {
    console.error("Unexpected error in submit-form:", err);
    return errorResponse("Error interno del servidor", 500);
  }
}
