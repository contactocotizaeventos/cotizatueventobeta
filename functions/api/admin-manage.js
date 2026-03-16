/**
 * /api/admin-manage
 *
 * All routes require Bearer token signed with ADMIN_SECRET.
 *
 * ── GET routes (via ?action=...) ──
 *   solicitudes   → pending requests, ORDER BY fecha_registro DESC
 *   proveedores   → all providers, ORDER BY categoria, posicion
 *   categorias    → groups with nested tags + provider count per tag
 *   config        → all config rows as { clave: valor }
 *   suscripciones → JOIN suscriptores + suscripciones + proveedores
 *
 * ── POST routes (via body { action, ... }) ──
 *   aprobar            → approve request → create provider → Email 2
 *   rechazar           → delete request
 *   set_config         → upsert config row
 *   set_suscripcion    → register payment → Email 3
 *   quitar_destacado   → set posicion=0, cancel active subscription
 *   create_categoria / update_categoria / delete_categoria
 *   create_etiqueta  / update_etiqueta  / delete_etiqueta
 *
 * ── PUT  → update provider fields (whitelist)
 * ── DELETE → delete provider
 *
 * New tables required (run in Supabase SQL editor before deploying):
 *
 * CREATE TABLE suscriptores (
 *   id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   email         text UNIQUE NOT NULL,
 *   password_hash text NOT NULL,
 *   nombre        text NOT NULL,
 *   proveedor_id  uuid REFERENCES proveedores(id) ON DELETE SET NULL,
 *   creado_en     timestamptz DEFAULT now()
 * );
 *
 * CREATE TABLE suscripciones (
 *   id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   suscriptor_id     uuid REFERENCES suscriptores(id) ON DELETE CASCADE NOT NULL,
 *   plan              text NOT NULL,
 *   estado            text NOT NULL DEFAULT 'activa',
 *   pago_automatico   boolean DEFAULT false,
 *   fecha_inicio      timestamptz NOT NULL DEFAULT now(),
 *   fecha_vencimiento timestamptz NOT NULL,
 *   fecha_cancelacion timestamptz,
 *   monto             integer NOT NULL,
 *   notas             text DEFAULT ''
 * );
 *
 * CREATE TABLE config (
 *   clave text PRIMARY KEY,
 *   valor text NOT NULL
 * );
 * INSERT INTO config (clave, valor) VALUES ('modo_prueba', 'false');
 */

import { createClient } from "@supabase/supabase-js";

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

function err(message, status = 500) {
  return json({ ok: false, error: message }, status);
}

// ── Token verification ───────────────────────────────────────────────

async function verifyToken(request, secret) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;

  const token = auth.slice(7);
  const dotIdx = token.indexOf(".");
  if (dotIdx === -1) return null;

  const payloadB64 = token.slice(0, dotIdx);
  const sigB64 = token.slice(dotIdx + 1);

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  // Decode signature from base64url
  const sigStr = atob(sigB64.replace(/-/g, "+").replace(/_/g, "/"));
  const sigBuf = new Uint8Array(sigStr.length);
  for (let i = 0; i < sigStr.length; i++) sigBuf[i] = sigStr.charCodeAt(i);

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBuf,
    encoder.encode(payloadB64)
  );

  if (!valid) return null;

  // Decode payload
  const payloadStr = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
  const payload = JSON.parse(payloadStr);

  // Check expiration
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

// ── Email utility ────────────────────────────────────────────────────

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
  } catch (e) {
    console.error("sendEmail failed:", e);
  }
}

// ── Email 2: Solicitud aprobada ──────────────────────────────────────

function buildApprovalEmail(nombre, posicion) {
  const planNombre = posicion === 1 ? "Destacado" : "Básico";
  const planColor = posicion === 1 ? "#E8542A" : "#8A8278";
  const upgradeBlock =
    posicion === 0
      ? `
    <p style="margin:0 0 16px 0;line-height:1.6;color:#3D3733;">
      Tu perfil fue aprobado con el plan <strong>Básico</strong>. Para obtener mayor visibilidad, puedes activar tu suscripción <strong>Destacado</strong>:
    </p>
    <ul style="margin:0 0 16px 0;padding-left:20px;line-height:1.8;color:#3D3733;">
      <li>Foto de portada y logo en tu perfil</li>
      <li>Descripción completa visible</li>
      <li>Botón directo a WhatsApp</li>
      <li>Posición prioritaria en el directorio</li>
    </ul>
    <a href="https://www.cotizaeventos.cl/suscripciones.html" style="display:inline-block;background:#E8542A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">
      ✦ Activar Destacado
    </a>`
      : `
    <p style="margin:0 0 16px 0;line-height:1.6;color:#3D3733;">
      Tu perfil fue aprobado con el plan <strong style="color:#E8542A;">✦ Destacado</strong>. Tu negocio aparecerá con máxima visibilidad en el directorio.
    </p>`;

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#FAFAF8;padding:32px 16px;color:#1A1714;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:14px;padding:40px 32px;border:1px solid #E8E4DF;">
    <h1 style="font-size:22px;margin:0 0 8px 0;color:#E8542A;">CotizaEventos.cl</h1>
    <h2 style="font-size:18px;margin:0 0 24px 0;color:#1A1714;">¡Tu negocio ya está en el directorio! 🎉</h2>
    <p style="margin:0 0 16px 0;line-height:1.6;color:#3D3733;">
      Hola, <strong>${nombre}</strong>.
    </p>
    <p style="margin:0 0 16px 0;line-height:1.6;color:#3D3733;">
      Nos alegra informarte que tu solicitud fue <strong style="color:#06C7A5;">aprobada</strong>. Tu negocio ya es visible para miles de personas que buscan proveedores en Santiago.
    </p>
    <p style="margin:0 0 16px 0;">
      <span style="display:inline-block;background:${planColor};color:#fff;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600;">
        Plan: ${planNombre}
      </span>
    </p>
    ${upgradeBlock}
    <hr style="border:none;border-top:1px solid #E8E4DF;margin:32px 0 16px 0;">
    <p style="margin:0;font-size:12px;color:#8A8278;">
      Enviado automáticamente por CotizaEventos.cl
    </p>
  </div>
</body>
</html>`.trim();
}

// ── Email 3: Suscripción activada ────────────────────────────────────

function buildSubscriptionEmail(nombre, plan, monto, fechaInicio, fechaVencimiento) {
  const planLabel = plan === "anual" ? "Anual" : "Mensual";
  const montoFmt = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(monto);
  const fInicio = new Date(fechaInicio).toLocaleDateString("es-CL");
  const fVenc = new Date(fechaVencimiento).toLocaleDateString("es-CL");

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#FAFAF8;padding:32px 16px;color:#1A1714;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:14px;padding:40px 32px;border:1px solid #E8E4DF;">
    <h1 style="font-size:22px;margin:0 0 8px 0;color:#E8542A;">CotizaEventos.cl</h1>
    <h2 style="font-size:18px;margin:0 0 24px 0;color:#1A1714;">Suscripción Destacado activada ✦</h2>
    <p style="margin:0 0 16px 0;line-height:1.6;color:#3D3733;">
      Hola, <strong>${nombre}</strong>.
    </p>
    <p style="margin:0 0 16px 0;line-height:1.6;color:#3D3733;">
      Tu suscripción <strong style="color:#E8542A;">Destacado</strong> fue activada exitosamente.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px 0;">
      <tr><td style="padding:8px 0;color:#8A8278;width:140px;">Plan</td><td style="padding:8px 0;font-weight:600;">${planLabel}</td></tr>
      <tr><td style="padding:8px 0;color:#8A8278;">Monto</td><td style="padding:8px 0;font-weight:600;">${montoFmt}</td></tr>
      <tr><td style="padding:8px 0;color:#8A8278;">Fecha inicio</td><td style="padding:8px 0;">${fInicio}</td></tr>
      <tr><td style="padding:8px 0;color:#8A8278;">Vencimiento</td><td style="padding:8px 0;">${fVenc}</td></tr>
    </table>
    <p style="margin:0 0 16px 0;line-height:1.6;color:#3D3733;">
      Puedes gestionar tu suscripción en cualquier momento:
    </p>
    <a href="https://www.cotizaeventos.cl/suscripciones.html" style="display:inline-block;background:#E8542A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">
      Gestionar suscripción
    </a>
    <hr style="border:none;border-top:1px solid #E8E4DF;margin:32px 0 16px 0;">
    <p style="margin:0;font-size:12px;color:#8A8278;">
      Enviado automáticamente por CotizaEventos.cl
    </p>
  </div>
</body>
</html>`.trim();
}

// ── Slugify ──────────────────────────────────────────────────────────

function slugify(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ══════════════════════════════════════════════════════════════════════
// PROVIDER FIELD WHITELIST (for PUT updates)
// ══════════════════════════════════════════════════════════════════════

const PROVIDER_FIELDS = [
  "nombre", "responsable", "descripcion", "diferenciador", "tagline",
  "experiencia", "capacidad", "categoria", "etiqueta_id", "comunas",
  "precio_minimo", "precio_maximo", "incluye", "no_incluye",
  "whatsapp", "telefono", "email", "web", "instagram", "facebook",
  "tiktok", "youtube", "logo_emoji", "logo_url", "cover_url",
  "posicion", "activo",
];

// ══════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════

export async function onRequest(context) {
  const { request, env } = context;

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // Validate env
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.ADMIN_SECRET) {
    console.error("Missing required env vars");
    return err("Error de configuración del servidor", 500);
  }

  // ── Verify admin token ─────────────────────────────────────────────
  const payload = await verifyToken(request, env.ADMIN_SECRET);
  if (!payload || payload.sub !== "admin") {
    return err("No autorizado", 401);
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  const url = new URL(request.url);

  // ══════════════════════════════════════════════════════════════════
  // GET ROUTES
  // ══════════════════════════════════════════════════════════════════

  if (request.method === "GET") {
    const action = url.searchParams.get("action");

    // ── GET solicitudes ──────────────────────────────────────────────
    if (action === "solicitudes") {
      const { data, error } = await supabase
        .from("solicitudes")
        .select("*")
        .order("fecha_registro", { ascending: false });
      if (error) return err("Error al cargar solicitudes", 500);
      return json({ ok: true, solicitudes: data });
    }

    // ── GET proveedores ──────────────────────────────────────────────
    if (action === "proveedores") {
      const { data, error } = await supabase
        .from("proveedores")
        .select("*")
        .order("categoria", { ascending: true })
        .order("posicion", { ascending: true });
      if (error) return err("Error al cargar proveedores", 500);
      return json({ ok: true, proveedores: data });
    }

    // ── GET categorias (with nested etiquetas + provider count) ──────
    if (action === "categorias") {
      const { data: cats, error: e1 } = await supabase
        .from("categorias")
        .select("*")
        .order("orden", { ascending: true });
      if (e1) return err("Error al cargar categorías", 500);

      const { data: etqs, error: e2 } = await supabase
        .from("etiquetas")
        .select("*")
        .order("categoria_id", { ascending: true })
        .order("orden", { ascending: true });
      if (e2) return err("Error al cargar etiquetas", 500);

      // Count providers per etiqueta
      const { data: provs, error: e3 } = await supabase
        .from("proveedores")
        .select("etiqueta_id")
        .eq("activo", true);
      if (e3) return err("Error al contar proveedores", 500);

      const countByEtiq = {};
      for (const p of provs) {
        const key = p.etiqueta_id || "";
        countByEtiq[key] = (countByEtiq[key] || 0) + 1;
      }

      const grupos = cats.map((c) => ({
        ...c,
        etiquetas: (etqs || [])
          .filter((e) => e.categoria_id === c.id)
          .map((e) => ({ ...e, proveedores_count: countByEtiq[e.id] || 0 })),
      }));

      return json({ ok: true, grupos });
    }

    // ── GET config ───────────────────────────────────────────────────
    if (action === "config") {
      const { data, error } = await supabase.from("config").select("*");
      if (error) return err("Error al cargar config", 500);
      const config = {};
      for (const row of data || []) config[row.clave] = row.valor;
      return json({ ok: true, config });
    }

    // ── GET suscripciones (admin view: all providers + subscription status)
    if (action === "suscripciones") {
      // Get all suscriptores with their latest subscription
      const { data: suscriptores, error: e1 } = await supabase
        .from("suscriptores")
        .select("id, email, nombre, proveedor_id");
      if (e1) return err("Error al cargar suscriptores", 500);

      const { data: suscripciones, error: e2 } = await supabase
        .from("suscripciones")
        .select("*")
        .order("fecha_inicio", { ascending: false });
      if (e2) return err("Error al cargar suscripciones", 500);

      const { data: proveedores, error: e3 } = await supabase
        .from("proveedores")
        .select("id, nombre, email, posicion, activo");
      if (e3) return err("Error al cargar proveedores", 500);

      // Build joined view
      const provMap = {};
      for (const p of proveedores) provMap[p.id] = p;

      const subsBySuscriptor = {};
      for (const s of suscripciones || []) {
        if (!subsBySuscriptor[s.suscriptor_id]) subsBySuscriptor[s.suscriptor_id] = [];
        subsBySuscriptor[s.suscriptor_id].push(s);
      }

      const result = (suscriptores || []).map((s) => {
        const prov = s.proveedor_id ? provMap[s.proveedor_id] : null;
        const subs = subsBySuscriptor[s.id] || [];
        const activeSub = subs.find((x) => x.estado === "activa") || null;
        return {
          suscriptor: s,
          proveedor: prov,
          suscripcion_activa: activeSub,
          historial: subs,
        };
      });

      return json({ ok: true, suscripciones: result, proveedores });
    }

    return err("Acción GET no reconocida", 400);
  }

  // ══════════════════════════════════════════════════════════════════
  // PUT — Update provider
  // ══════════════════════════════════════════════════════════════════

  if (request.method === "PUT") {
    let body;
    try { body = await request.json(); } catch { return err("JSON inválido", 400); }

    const { id, fields } = body;
    if (!id || !fields) return err("Se requiere id y fields", 400);

    // Whitelist fields
    const safeFields = {};
    for (const key of Object.keys(fields)) {
      if (PROVIDER_FIELDS.includes(key)) {
        safeFields[key] = fields[key];
      }
    }

    if (Object.keys(safeFields).length === 0) {
      return err("No se proporcionaron campos válidos", 400);
    }

    const { error } = await supabase
      .from("proveedores")
      .update(safeFields)
      .eq("id", id);
    if (error) {
      console.error("Error updating provider:", error);
      return err("Error al actualizar proveedor", 500);
    }

    return json({ ok: true });
  }

  // ══════════════════════════════════════════════════════════════════
  // DELETE — Delete provider
  // ══════════════════════════════════════════════════════════════════

  if (request.method === "DELETE") {
    let body;
    try { body = await request.json(); } catch { return err("JSON inválido", 400); }

    const { id } = body;
    if (!id) return err("Se requiere id", 400);

    const { error } = await supabase.from("proveedores").delete().eq("id", id);
    if (error) {
      console.error("Error deleting provider:", error);
      return err("Error al eliminar proveedor", 500);
    }

    return json({ ok: true });
  }

  // ══════════════════════════════════════════════════════════════════
  // POST ROUTES
  // ══════════════════════════════════════════════════════════════════

  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return err("JSON inválido", 400); }

    const { action } = body;

    // ── APROBAR solicitud ────────────────────────────────────────────
    if (action === "aprobar") {
      const { id, posicion } = body;
      if (!id) return err("Se requiere id de solicitud", 400);

      // 1. Read solicitud
      const { data: sol, error: e1 } = await supabase
        .from("solicitudes")
        .select("*")
        .eq("id", id)
        .single();
      if (e1 || !sol) return err("Solicitud no encontrada", 404);

      // 2. Resolve primary category
      let primaryCat = "";
      if (sol.categorias && sol.categorias.length > 0) {
        const catSlug = sol.categorias[0];
        // Look up in etiquetas
        const { data: etiq } = await supabase
          .from("etiquetas")
          .select("id, categoria_id")
          .eq("id", catSlug)
          .single();
        if (etiq) {
          primaryCat = etiq.id;
        } else {
          primaryCat = slugify(catSlug);
        }
      }

      // 3. Check modo_prueba
      let finalPos = typeof posicion === "number" ? posicion : parseInt(posicion || "0", 10);
      const { data: configRows } = await supabase
        .from("config")
        .select("valor")
        .eq("clave", "modo_prueba")
        .single();
      if (configRows && configRows.valor === "true") {
        finalPos = 1; // Force Destacado in test mode
      }

      // 4. Insert provider
      const provData = {
        nombre: sol.nombre || "",
        responsable: sol.responsable || "",
        descripcion: sol.descripcion || "",
        diferenciador: sol.diferenciador || "",
        experiencia: sol.experiencia || "",
        capacidad: sol.capacidad || "",
        categoria: primaryCat,
        etiqueta_id: primaryCat,
        comunas: sol.comunas || "",
        precio_minimo: sol.precio_minimo || "",
        precio_maximo: sol.precio_maximo || "",
        incluye: sol.incluye || "",
        no_incluye: sol.no_incluye || "",
        whatsapp: sol.whatsapp || "",
        telefono: sol.telefono || "",
        email: (sol.email || "").toLowerCase(),
        web: sol.web || "",
        instagram: sol.instagram || "",
        facebook: sol.facebook || "",
        tiktok: sol.tiktok || "",
        youtube: sol.youtube || "",
        logo_emoji: sol.logo_emoji || "",
        logo_url: sol.logo_url || "",
        cover_url: sol.cover_url || "",
        posicion: finalPos,
        activo: true,
        solicitud_id: sol.id,
        fecha_aprobacion: new Date().toISOString(),
      };

      const { data: newProv, error: e2 } = await supabase
        .from("proveedores")
        .insert([provData])
        .select("id")
        .single();
      if (e2) {
        console.error("Error inserting provider:", e2);
        return err("Error al crear proveedor", 500);
      }

      // 5. Update solicitud
      await supabase
        .from("solicitudes")
        .update({ estado: "aprobada", proveedor_id: newProv.id })
        .eq("id", id);

      // 6. If suscriptor exists with this email, link proveedor_id
      const { data: existingSub } = await supabase
        .from("suscriptores")
        .select("id")
        .eq("email", (sol.email || "").toLowerCase())
        .single();
      if (existingSub) {
        await supabase
          .from("suscriptores")
          .update({ proveedor_id: newProv.id })
          .eq("id", existingSub.id);
      }

      // 7. Send Email 2 (non-blocking)
      if (env.RESEND_API_KEY && env.EMAIL_FROM && sol.email) {
        const emailHtml = buildApprovalEmail(sol.nombre || "Proveedor", finalPos);
        sendEmail(
          sol.email,
          "¡Tu negocio ya está en CotizaEventos.cl! 🎉",
          emailHtml,
          env
        );
      }

      return json({ ok: true, proveedor_id: newProv.id, posicion: finalPos });
    }

    // ── RECHAZAR solicitud ───────────────────────────────────────────
    if (action === "rechazar") {
      const { id } = body;
      if (!id) return err("Se requiere id", 400);
      const { error } = await supabase.from("solicitudes").delete().eq("id", id);
      if (error) return err("Error al rechazar solicitud", 500);
      return json({ ok: true });
    }

    // ── SET CONFIG ───────────────────────────────────────────────────
    if (action === "set_config") {
      const { clave, valor } = body;
      if (!clave || valor === undefined) return err("Se requiere clave y valor", 400);

      const { error } = await supabase
        .from("config")
        .upsert({ clave, valor: String(valor) }, { onConflict: "clave" });
      if (error) {
        console.error("Error upserting config:", error);
        return err("Error al guardar config", 500);
      }
      return json({ ok: true });
    }

    // ── SET SUSCRIPCION (admin registers a payment) ──────────────────
    if (action === "set_suscripcion") {
      const { suscriptor_id, plan, fecha_inicio, fecha_vencimiento, monto } = body;
      if (!suscriptor_id || !plan || !fecha_inicio || !fecha_vencimiento || !monto) {
        return err("Faltan campos obligatorios", 400);
      }

      // Insert subscription
      const { error: e1 } = await supabase.from("suscripciones").insert([{
        suscriptor_id,
        plan,
        estado: "activa",
        fecha_inicio,
        fecha_vencimiento,
        monto: parseInt(monto, 10),
      }]);
      if (e1) {
        console.error("Error inserting subscription:", e1);
        return err("Error al registrar suscripción", 500);
      }

      // Get suscriptor to find proveedor_id and email
      const { data: sub, error: e2 } = await supabase
        .from("suscriptores")
        .select("proveedor_id, email, nombre")
        .eq("id", suscriptor_id)
        .single();
      if (e2 || !sub) return err("Suscriptor no encontrado", 404);

      // Update provider to Destacado
      if (sub.proveedor_id) {
        await supabase
          .from("proveedores")
          .update({ posicion: 1 })
          .eq("id", sub.proveedor_id);
      }

      // Send Email 3 (non-blocking)
      if (env.RESEND_API_KEY && env.EMAIL_FROM && sub.email) {
        const emailHtml = buildSubscriptionEmail(
          sub.nombre || "Proveedor",
          plan,
          parseInt(monto, 10),
          fecha_inicio,
          fecha_vencimiento
        );
        sendEmail(
          sub.email,
          "Suscripción Destacado activada en CotizaEventos.cl",
          emailHtml,
          env
        );
      }

      return json({ ok: true });
    }

    // ── QUITAR DESTACADO ─────────────────────────────────────────────
    if (action === "quitar_destacado") {
      const { proveedor_id } = body;
      if (!proveedor_id) return err("Se requiere proveedor_id", 400);

      // Set provider to Básico
      const { error: e1 } = await supabase
        .from("proveedores")
        .update({ posicion: 0 })
        .eq("id", proveedor_id);
      if (e1) return err("Error al actualizar proveedor", 500);

      // Find suscriptor linked to this provider and cancel active subscription
      const { data: sub } = await supabase
        .from("suscriptores")
        .select("id")
        .eq("proveedor_id", proveedor_id)
        .single();

      if (sub) {
        await supabase
          .from("suscripciones")
          .update({ estado: "cancelada", fecha_cancelacion: new Date().toISOString() })
          .eq("suscriptor_id", sub.id)
          .eq("estado", "activa");
      }

      return json({ ok: true });
    }

    // ── CATEGORÍAS CRUD ──────────────────────────────────────────────

    if (action === "create_categoria") {
      const { id: catId, nombre, ico, descripcion, orden } = body;
      if (!catId || !nombre) return err("Se requiere id y nombre", 400);
      const { error } = await supabase
        .from("categorias")
        .insert([{ id: catId, nombre, ico: ico || "", descripcion: descripcion || "", orden: orden || 0 }]);
      if (error) {
        console.error("Error creating categoria:", error);
        return err("Error al crear categoría", 500);
      }
      return json({ ok: true });
    }

    if (action === "update_categoria") {
      const { id: catId, nombre, ico, descripcion, orden } = body;
      if (!catId) return err("Se requiere id", 400);
      const fields = {};
      if (nombre !== undefined) fields.nombre = nombre;
      if (ico !== undefined) fields.ico = ico;
      if (descripcion !== undefined) fields.descripcion = descripcion;
      if (orden !== undefined) fields.orden = orden;
      const { error } = await supabase.from("categorias").update(fields).eq("id", catId);
      if (error) return err("Error al actualizar categoría", 500);
      return json({ ok: true });
    }

    if (action === "delete_categoria") {
      const { id: catId } = body;
      if (!catId) return err("Se requiere id", 400);
      const { error } = await supabase.from("categorias").delete().eq("id", catId);
      if (error) return err("Error al eliminar categoría", 500);
      return json({ ok: true });
    }

    // ── ETIQUETAS CRUD ───────────────────────────────────────────────

    if (action === "create_etiqueta") {
      const { id: etId, nombre, ico, descripcion, categoria_id, orden } = body;
      if (!etId || !nombre || !categoria_id) return err("Se requiere id, nombre y categoria_id", 400);
      const { error } = await supabase
        .from("etiquetas")
        .insert([{ id: etId, nombre, ico: ico || "", descripcion: descripcion || "", categoria_id, orden: orden || 0 }]);
      if (error) {
        console.error("Error creating etiqueta:", error);
        return err("Error al crear etiqueta", 500);
      }
      return json({ ok: true });
    }

    if (action === "update_etiqueta") {
      const { id: etId, nombre, ico, descripcion, categoria_id, orden } = body;
      if (!etId) return err("Se requiere id", 400);
      const fields = {};
      if (nombre !== undefined) fields.nombre = nombre;
      if (ico !== undefined) fields.ico = ico;
      if (descripcion !== undefined) fields.descripcion = descripcion;
      if (categoria_id !== undefined) fields.categoria_id = categoria_id;
      if (orden !== undefined) fields.orden = orden;
      const { error } = await supabase.from("etiquetas").update(fields).eq("id", etId);
      if (error) return err("Error al actualizar etiqueta", 500);
      return json({ ok: true });
    }

    if (action === "delete_etiqueta") {
      const { id: etId } = body;
      if (!etId) return err("Se requiere id", 400);
      const { error } = await supabase.from("etiquetas").delete().eq("id", etId);
      if (error) return err("Error al eliminar etiqueta", 500);
      return json({ ok: true });
    }

    return err("Acción POST no reconocida", 400);
  }

  return err("Método no permitido", 405);
}
