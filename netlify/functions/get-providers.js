// netlify/functions/get-providers.js
// Devuelve todos los proveedores aprobados para proveedores.html e index.html

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() };
  }

  try {
    const { data, error } = await supabase
      .from('proveedores')
      .select('*')
      .eq('activo', true)
      .order('categoria', { ascending: true })
      .order('posicion', { ascending: true });

    if (error) throw error;

    // Agrupar por categoría para el frontend
    const grupos = groupByCategoria(data);

    return respond(200, { providers: data, grupos });

  } catch (err) {
    console.error('get-providers error:', err);
    return respond(500, { error: 'Error al obtener proveedores', detail: err.message });
  }
};

function groupByCategoria(providers) {
  const CATEGORIAS = {
    banqueteria:   { ico: '🍽️', nombre: 'Banquetería',        desc: 'Servicio completo de banquetes y gastronomía de alto nivel' },
    pizzas:        { ico: '🍕', nombre: 'Catering Pizzas',     desc: 'Pizzas al horno de leña para todo tipo de eventos' },
    hamburguesas:  { ico: '🍔', nombre: 'Catering Hamburguesas',desc: 'Hamburguesas gourmet para eventos' },
    churrascos:    { ico: '🥩', nombre: 'Catering Churrascos', desc: 'Parrilla y carnes asadas para eventos' },
    completos:     { ico: '🌭', nombre: 'Catering Completos',  desc: 'Completos y hot dogs para todo tipo de eventos' },
    torta:         { ico: '🎂', nombre: 'Torta y Postres',     desc: 'Tortas personalizadas y mesas de postres' },
    barra:         { ico: '🍹', nombre: 'Barra de Tragos',     desc: 'Coctelería profesional y bar móvil' },
  };

  const map = {};
  providers.forEach(p => {
    const catKey = p.categoria;
    if (!map[catKey]) {
      map[catKey] = {
        id: catKey,
        ico: CATEGORIAS[catKey]?.ico || '🍽️',
        nombre: CATEGORIAS[catKey]?.nombre || catKey,
        desc: CATEGORIAS[catKey]?.desc || '',
        proveedores: [],
      };
    }
    map[catKey].proveedores.push({
      id:         p.id,
      pos:        p.posicion,
      logo:       p.logo_emoji || '🍽️',
      nombre:     p.nombre,
      tagline:    p.tagline || p.diferenciador || '',
      desc:       p.descripcion,
      diff:       p.diferenciador,
      minimo:     p.precio_minimo,
      maximo:     p.precio_maximo,
      comunas:    p.comunas,
      wa:         p.whatsapp,
      instagram:  p.instagram || '',
      web:        p.web || '',
      experiencia: p.experiencia || '',
      capacidad:  p.capacidad || '',
      incluye:    p.incluye || '',
    });
  });

  return [{
    id: 'catering',
    ico: '🍽️',
    nombre: 'Catering',
    categorias: Object.values(map),
  }];
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}
