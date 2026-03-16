/**
 * GET /api/get-providers
 *
 * Public endpoint — no authentication required.
 * Returns active providers grouped by category hierarchy:
 *   { providers: [...], grupos: [...] }
 *
 * Supabase tables used (existing, do NOT modify):
 *   - proveedores
 *   - categorias
 *   - etiquetas
 */

import { createClient } from "@supabase/supabase-js";

// ── Helpers ──────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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
 * mapProvider — expose only the fields the frontend needs.
 * Keep payloads small; never leak internal IDs unnecessarily.
 */
function mapProvider(p) {
  return {
    id: p.id,
    nombre: p.nombre,
    responsable: p.responsable,
    descripcion: p.descripcion,
    diferenciador: p.diferenciador,
    tagline: p.tagline,
    experiencia: p.experiencia,
    capacidad: p.capacidad,
    categoria: p.categoria,
    etiqueta_id: p.etiqueta_id,
    comunas: p.comunas,
    precio_minimo: p.precio_minimo,
    precio_maximo: p.precio_maximo,
    incluye: p.incluye,
    no_incluye: p.no_incluye,
    whatsapp: p.whatsapp,
    telefono: p.telefono,
    email: p.email,
    web: p.web,
    instagram: p.instagram,
    facebook: p.facebook,
    tiktok: p.tiktok,
    youtube: p.youtube,
    logo_emoji: p.logo_emoji,
    logo_url: p.logo_url,
    cover_url: p.cover_url,
    pos: p.posicion, // 0 = Básico, 1 = Destacado
  };
}

/**
 * buildGrupos — assemble the category hierarchy:
 *   grupo (categorias) → etiquetas → proveedores
 *
 * Icons come 100 % from the database. No hardcoded emojis.
 */
function buildGrupos(categorias, etiquetas, proveedores) {
  // Index providers by etiqueta_id for fast lookup
  const provsByEtiqueta = {};
  for (const p of proveedores) {
    const key = p.etiqueta_id || p.categoria;
    if (!provsByEtiqueta[key]) provsByEtiqueta[key] = [];
    provsByEtiqueta[key].push(mapProvider(p));
  }

  // Index etiquetas by categoria_id
  const etiqsByCategoria = {};
  for (const e of etiquetas) {
    if (!etiqsByCategoria[e.categoria_id]) etiqsByCategoria[e.categoria_id] = [];
    etiqsByCategoria[e.categoria_id].push(e);
  }

  // Build hierarchy
  const grupos = categorias.map((cat) => {
    const etiquetasDelGrupo = (etiqsByCategoria[cat.id] || []).map((et) => {
      const provs = provsByEtiqueta[et.id] || [];
      return {
        id: et.id,
        nombre: et.nombre,
        ico: et.ico,
        descripcion: et.descripcion,
        orden: et.orden,
        proveedores: provs,
        total: provs.length,
      };
    });

    // Total providers in this group (sum of all etiquetas)
    const total = etiquetasDelGrupo.reduce((sum, et) => sum + et.total, 0);

    return {
      id: cat.id,
      nombre: cat.nombre,
      ico: cat.ico,
      descripcion: cat.descripcion,
      orden: cat.orden,
      etiquetas: etiquetasDelGrupo,
      total,
    };
  });

  return grupos;
}

// ── Main handler ─────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context;

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method !== "GET") {
    return errorResponse("Método no permitido", 405);
  }

  // Validate environment
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    return errorResponse("Error de configuración del servidor", 500);
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  try {
    // 1. Load active providers ordered by categoria ASC, posicion ASC
    const { data: proveedores, error: errProv } = await supabase
      .from("proveedores")
      .select("*")
      .eq("activo", true)
      .order("categoria", { ascending: true })
      .order("posicion", { ascending: true });

    if (errProv) {
      console.error("Error loading proveedores:", errProv);
      return errorResponse("Error al cargar proveedores", 500);
    }

    // 2. Load categorias ordered by orden ASC
    const { data: categorias, error: errCat } = await supabase
      .from("categorias")
      .select("*")
      .order("orden", { ascending: true });

    if (errCat) {
      console.error("Error loading categorias:", errCat);
      return errorResponse("Error al cargar categorías", 500);
    }

    // 3. Load etiquetas ordered by categoria_id, orden ASC
    const { data: etiquetas, error: errEtiq } = await supabase
      .from("etiquetas")
      .select("*")
      .order("categoria_id", { ascending: true })
      .order("orden", { ascending: true });

    if (errEtiq) {
      console.error("Error loading etiquetas:", errEtiq);
      return errorResponse("Error al cargar etiquetas", 500);
    }

    // 4. Build hierarchical structure
    const grupos = buildGrupos(categorias, etiquetas, proveedores);

    // 5. Flat list of mapped providers (useful for search / filters)
    const providers = proveedores.map(mapProvider);

    return jsonResponse({ ok: true, providers, grupos });
  } catch (err) {
    console.error("Unexpected error in get-providers:", err);
    return errorResponse("Error interno del servidor", 500);
  }
}
