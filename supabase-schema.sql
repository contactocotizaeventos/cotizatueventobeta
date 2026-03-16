-- ══════════════════════════════════════════════════════
-- SUPABASE SCHEMA — CotizaTuFiesta.cl
-- Copia y pega esto en: Supabase Dashboard → SQL Editor → New Query
--
-- Tablas principales:
--   solicitudes  → formularios de registro pendientes de revisión
--   proveedores  → negocios aprobados y visibles en el sitio
--
-- Relación: una solicitud aprobada genera un registro en proveedores.
--   solicitudes.proveedor_id → proveedores.id
--   proveedores.solicitud_id → solicitudes.id (con ON DELETE SET NULL)
-- ══════════════════════════════════════════════════════


-- ── 1. TABLA SOLICITUDES ──────────────────────────────────────────────────────
-- Almacena los formularios de registro enviados por proveedores.
-- Estado inicial: 'pendiente'. El admin lo cambia a 'aprobada' o lo elimina.
CREATE TABLE IF NOT EXISTS solicitudes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Datos del negocio
  nombre            TEXT NOT NULL,         -- Nombre comercial del negocio
  responsable       TEXT,                  -- Nombre del dueño o encargado
  rut               TEXT,                  -- RUT del negocio (opcional)
  descripcion       TEXT,                  -- Descripción general del servicio
  diferenciador     TEXT,                  -- Propuesta de valor / qué los hace únicos
  experiencia       TEXT,                  -- Años o descripción de trayectoria
  capacidad         TEXT,                  -- Cantidad máxima de personas atendidas

  -- Categorías y ubicación
  categorias        TEXT[],                -- Array de slugs: ['banqueteria', 'pizzas']
  comunas           TEXT,                  -- Comunas o zonas de cobertura

  -- Precios
  precio_minimo     TEXT,                  -- Precio mínimo del servicio (texto libre, ej: "$150.000")
  precio_maximo     TEXT,                  -- Precio máximo del servicio
  incluye           TEXT,                  -- Qué está incluido en el precio
  no_incluye        TEXT,                  -- Qué no está incluido
  anticipacion      TEXT,                  -- Días de anticipación requeridos para reservar
  anticipo          TEXT,                  -- Porcentaje o monto de anticipo requerido

  -- Contacto
  whatsapp          TEXT NOT NULL,         -- Número de WhatsApp (obligatorio)
  telefono          TEXT,                  -- Teléfono alternativo
  email             TEXT NOT NULL,         -- Correo electrónico (obligatorio)

  -- Redes sociales y web
  web               TEXT,
  instagram         TEXT,
  facebook          TEXT,
  tiktok            TEXT,
  youtube           TEXT,
  direccion         TEXT,                  -- Dirección física (si aplica)

  -- Opciones de publicación
  posicion_deseada  TEXT,                  -- Tier solicitado (Oro/Plata/Bronce/Básico)
  logo_url          TEXT,                  -- URL del logo subido a Supabase Storage
  logo_emoji        TEXT DEFAULT '🍽️',     -- Emoji alternativo si no hay logo
  comentarios       TEXT,                  -- Notas adicionales del proveedor

  -- Control interno
  estado            TEXT DEFAULT 'pendiente',  -- 'pendiente' | 'aprobada'
  proveedor_id      UUID,                      -- FK al proveedor creado tras la aprobación
  fecha_registro    TIMESTAMPTZ DEFAULT NOW()
);


-- ── 2. TABLA PROVEEDORES ──────────────────────────────────────────────────────
-- Almacena los negocios aprobados que aparecen públicamente en el sitio.
-- Sistema de posiciones (tiers):
--   posicion = 1 → Oro    (máxima visibilidad, primero en listado)
--   posicion = 2 → Plata
--   posicion = 3 → Bronce
--   posicion ≥ 4 → Básico (último en listado)
CREATE TABLE IF NOT EXISTS proveedores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Datos del negocio
  nombre            TEXT NOT NULL,
  responsable       TEXT,
  tagline           TEXT,                  -- Frase corta para mostrar en la tarjeta
  descripcion       TEXT,
  diferenciador     TEXT,
  experiencia       TEXT,
  capacidad         TEXT,

  -- Clasificación
  categoria         TEXT NOT NULL,         -- Slug de la categoría principal (ej: 'pizzas')
  comunas           TEXT,

  -- Precios
  precio_minimo     TEXT,
  precio_maximo     TEXT,
  incluye           TEXT,
  no_incluye        TEXT,

  -- Contacto
  whatsapp          TEXT,
  telefono          TEXT,
  email             TEXT,

  -- Redes sociales y web
  web               TEXT,
  instagram         TEXT,
  facebook          TEXT,
  tiktok            TEXT,
  youtube           TEXT,

  -- Imágenes
  logo_emoji        TEXT DEFAULT '🍽️',     -- Emoji de fallback si no hay logo
  logo_url          TEXT,                  -- URL del logo en Supabase Storage
  cover_url         TEXT,                  -- URL de imagen de portada

  -- Control de visibilidad
  posicion          INTEGER DEFAULT 4,     -- 1=Oro, 2=Plata, 3=Bronce, 4+=Básico
  activo            BOOLEAN DEFAULT true,  -- false = oculto en el sitio público

  -- Trazabilidad
  solicitud_id      UUID REFERENCES solicitudes(id) ON DELETE SET NULL,
  fecha_aprobacion  TIMESTAMPTZ DEFAULT NOW()
);


-- ── 3. ÍNDICES ────────────────────────────────────────────────────────────────
-- Mejoran el rendimiento de las consultas más frecuentes en el sitio:
--   - filtrar por categoría
--   - filtrar solo activos
--   - ordenar por posición dentro de cada categoría
CREATE INDEX IF NOT EXISTS idx_proveedores_categoria ON proveedores(categoria);
CREATE INDEX IF NOT EXISTS idx_proveedores_activo    ON proveedores(activo);
CREATE INDEX IF NOT EXISTS idx_proveedores_posicion  ON proveedores(categoria, posicion);
CREATE INDEX IF NOT EXISTS idx_solicitudes_estado    ON solicitudes(estado);


-- ── 4. ROW LEVEL SECURITY (RLS) ───────────────────────────────────────────────
-- La service key usada en las Cloudflare Functions bypasea todo el RLS.
-- Las políticas protegen el acceso directo desde el frontend (anon key).
ALTER TABLE solicitudes ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;

-- Solo lectura pública en proveedores activos (para quien use la anon key)
CREATE POLICY "Public can read active providers"
  ON proveedores FOR SELECT
  USING (activo = true);

-- Nota: no se permiten INSERT/UPDATE/DELETE directos desde el frontend.
-- Todas las escrituras pasan por las Cloudflare Functions con la service key.


-- ── 5. DATOS DE EJEMPLO ───────────────────────────────────────────────────────
-- Proveedores de muestra que aparecen en el sitio al hacer el deploy inicial.
-- Puedes eliminar estos INSERT si prefieres empezar desde cero.
INSERT INTO proveedores (nombre, tagline, descripcion, diferenciador, experiencia, capacidad, categoria, comunas, precio_minimo, precio_maximo, incluye, whatsapp, instagram, logo_emoji, posicion, activo) VALUES
  ('Banquetería Épica',       'Menús de autor para matrimonios y eventos corporativos', 'Cocina de autor con ingredientes de temporada. El equipo de chefs más premiado de Chile para eventos de lujo.', '✦ Chefs de autor + sommelier incluido', '12 años', 'Hasta 500 personas', 'banqueteria', 'RM completa',         '$800.000', '$4.000.000', 'Chef, personal, montaje y sommelier', '56911100001', '@banqueteriaepica',    '🍽️', 1, true),
  ('Gourmet Events Chile',    'Buffet premium con estaciones temáticas en vivo',          'Buffet de nivel cinco estrellas con estaciones de cocina en vivo.',                                               '✦ Estaciones de cocina en vivo',        '8 años',  'Hasta 400 personas', 'banqueteria', 'RM y alrededores',     '$600.000', '$2.500.000', 'Chefs en estación y personal',          '56911100002', '@gourmetevents.cl',    '🥂', 2, true),
  ('Banquetería Boutique',    'Menús veganos y sin gluten, 100% saludable',               'Cocina saludable, vegana y sin gluten que es también deliciosa.',                                                 '✦ 100% orgánico, vegano y sin gluten',  '5 años',  'Hasta 200 personas', 'banqueteria', 'Providencia, Las Condes', '$400.000', '$1.500.000', 'Menú personalizado',                    '56911100003', '@banqueteriaboutique', '🌿', 3, true),
  ('La Leñera Events',        'Horno de leña artesanal, masa madre, hasta 500 personas', 'El único catering de pizzas con horno de leña portátil artesanal construido en piedra volcánica.',              '✦ Horno de leña artesanal en piedra volcánica', '7 años', 'Hasta 500 personas', 'pizzas', 'RM completa', '$250.000', '$900.000', 'Horno, personal, ingredientes y montaje', '56911110001', '@lalenera.events', '🍕', 1, true),
  ('Napoli Party',            'Chef italiano certificado, 15 variedades en carta',        'Único catering en Chile con chef pizzaiolo certificado en Nápoles.',                                             '✦ Chef certificado en Nápoles, Italia', '10 años', 'Hasta 300 personas', 'pizzas', 'Providencia, Las Condes', '$200.000', '$700.000', 'Chef certificado y montaje',           '56911110002', '@napoliparty.cl',     '🇮🇹', 2, true),
  ('Burger Masters Events',   'Carne Angus 200g, pan brioche artesanal, 12 variedades',  'La hamburguesa más premiada de los eventos en Chile.',                                                            '✦ Carne Angus + pan brioche artesanal', '9 años',  'Hasta 400 personas', 'hamburguesas', 'RM completa',       '$280.000', '$850.000', 'Carne Angus, brioche y papas',          '56911120001', '@burgermasters.events','🍔', 1, true),
  ('Asado VIP Chile',         'Parrilla en sitio, cortes premium Wagyu y Angus',          'El asado más premium de Chile para eventos.',                                                                     '✦ Wagyu japonés · parrillero maestro',  '20 años', 'Hasta 600 personas', 'churrascos', 'RM completa',       '$400.000', '$2.000.000','Parrilla, cortes premium y carbón',     '56911130001', '@asadovip.cl',        '🥩', 1, true),
  ('El Completo Real',        'El completo italiano más grande de Chile, pan artesanal', 'El completo más icónico de los eventos en Chile.',                                                                '✦ Pan de 25cm artesanal, el más grande','11 años', 'Hasta 500 personas', 'completos', 'RM completa',        '$150.000', '$500.000', 'Pan artesanal y vienesa premium',       '56911140001', NULL,                  '🌭', 1, true),
  ('Dulce Arte Cakes',        'Tortas esculpidas a mano, las más fotografiadas de Santiago','Cada torta es una pieza única diseñada especialmente para ti.',                                                '✦ Cada torta es una obra de arte única','9 años',  'Eventos hasta 500',  'torta', 'RM completa',           '$80.000',  '$350.000', 'Diseño personalizado y caja',           '56911200001', '@dulceartecakes',     '🎂', 1, true),
  ('Mixology Masters',        'Bartenders que han competido en campeonatos internacionales','Shows de flair bartending incluidos y menú de cócteles de autor.',                                             '✦ Bartenders de competencia + flair show','10 años','Hasta 400 personas', 'barra', 'RM completa',          '$280.000', '$750.000', 'Barra, licores, hielo y flair show',    '56911210001', '@mixologymasters.cl', '🍸', 1, true);


-- ══════════════════════════════════════════════════════
-- VARIABLES DE ENTORNO REQUERIDAS EN CLOUDFLARE PAGES:
--   SUPABASE_URL         → Settings > API > Project URL
--   SUPABASE_SERVICE_KEY → Settings > API > service_role key
--   ADMIN_USER           → Tu usuario de admin (ej: admin)
--   ADMIN_PASS           → Tu contraseña segura
--   ADMIN_SECRET         → String random de 32+ chars para firmar tokens JWT
-- ══════════════════════════════════════════════════════
