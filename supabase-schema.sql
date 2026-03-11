-- ══════════════════════════════════════════════════════
-- SUPABASE SCHEMA — CotizaTuFiesta.cl
-- Copia y pega esto en: Supabase Dashboard → SQL Editor → New Query
-- ══════════════════════════════════════════════════════

-- 1. TABLA SOLICITUDES (formulario de proveedores)
CREATE TABLE IF NOT EXISTS solicitudes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre            TEXT NOT NULL,
  responsable       TEXT,
  rut               TEXT,
  descripcion       TEXT,
  diferenciador     TEXT,
  experiencia       TEXT,
  capacidad         TEXT,
  categorias        TEXT[],          -- array: ['banqueteria', 'pizzas']
  comunas           TEXT,
  precio_minimo     TEXT,
  precio_maximo     TEXT,
  incluye           TEXT,
  no_incluye        TEXT,
  anticipacion      TEXT,
  anticipo          TEXT,
  whatsapp          TEXT NOT NULL,
  telefono          TEXT,
  email             TEXT NOT NULL,
  web               TEXT,
  instagram         TEXT,
  facebook          TEXT,
  tiktok            TEXT,
  youtube           TEXT,
  direccion         TEXT,
  posicion_deseada  TEXT,
  logo_url          TEXT,
  logo_emoji        TEXT DEFAULT '🍽️',
  comentarios       TEXT,
  estado            TEXT DEFAULT 'pendiente',  -- 'pendiente' | 'aprobada'
  proveedor_id      UUID,
  fecha_registro    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABLA PROVEEDORES (aprobados, aparecen en el sitio)
CREATE TABLE IF NOT EXISTS proveedores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre            TEXT NOT NULL,
  responsable       TEXT,
  tagline           TEXT,
  descripcion       TEXT,
  diferenciador     TEXT,
  experiencia       TEXT,
  capacidad         TEXT,
  categoria         TEXT NOT NULL,  -- 'banqueteria' | 'pizzas' | 'hamburguesas' | etc.
  comunas           TEXT,
  precio_minimo     TEXT,
  precio_maximo     TEXT,
  incluye           TEXT,
  no_incluye        TEXT,
  whatsapp          TEXT,
  telefono          TEXT,
  email             TEXT,
  web               TEXT,
  instagram         TEXT,
  facebook          TEXT,
  tiktok            TEXT,
  youtube           TEXT,
  logo_emoji        TEXT DEFAULT '🍽️',
  logo_url          TEXT,
  posicion          INTEGER DEFAULT 4,  -- 1=Oro, 2=Plata, 3=Bronce, 4+=Básico
  activo            BOOLEAN DEFAULT true,
  solicitud_id      UUID REFERENCES solicitudes(id) ON DELETE SET NULL,
  fecha_aprobacion  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. INDICES para mejor performance
CREATE INDEX IF NOT EXISTS idx_proveedores_categoria ON proveedores(categoria);
CREATE INDEX IF NOT EXISTS idx_proveedores_activo ON proveedores(activo);
CREATE INDEX IF NOT EXISTS idx_proveedores_posicion ON proveedores(categoria, posicion);
CREATE INDEX IF NOT EXISTS idx_solicitudes_estado ON solicitudes(estado);

-- 4. ROW LEVEL SECURITY — la service key bypasea todo,
--    pero protegemos con políticas por si acaso
ALTER TABLE solicitudes ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;

-- La service key (usada en las Netlify Functions) tiene acceso total.
-- Políticas públicas: solo lectura en proveedores activos.
CREATE POLICY "Public can read active providers"
  ON proveedores FOR SELECT
  USING (activo = true);

-- Nadie puede escribir directamente desde el frontend (solo vía Functions)
-- (las Functions usan service key que bypasea RLS)

-- 5. DATOS DE EJEMPLO — los proveedores actuales del sitio
-- (Puedes eliminar estos INSERT si quieres empezar desde cero)

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
-- LISTO. Ahora configura estas variables en Netlify:
--   SUPABASE_URL        → Settings > API > Project URL
--   SUPABASE_SERVICE_KEY→ Settings > API > service_role key
--   ADMIN_USER          → tu usuario de admin (ej: admin)
--   ADMIN_PASS          → tu contraseña segura
--   ADMIN_SECRET        → string random de 32+ chars para firmar tokens
-- ══════════════════════════════════════════════════════
