# Affiliate & Commission Engine

Aplicación de Shopify que permite a comerciantes crear campañas de afiliados, rastrear ventas mediante enlaces personalizados y monetizar la infraestructura mediante una tarifa de servicio del **5% sobre cada venta referida**, cobrada vía Shopify Billing API con `UsageRecord`.

> **Prueba técnica** desarrollada para Converxity / Shopify App Developer.

---

## Tabla de contenidos

1. [Stack tecnológico](#stack-tecnológico)
2. [Instalación y ejecución local](#instalación-y-ejecución-local)
3. [Arquitectura general](#arquitectura-general)
4. [Decisiones de arquitectura](#decisiones-de-arquitectura)
5. [Modelo de datos y consultas críticas](#modelo-de-datos-y-consultas-críticas)
6. [Asincronía e idempotencia en facturación](#asincronía-e-idempotencia-en-facturación)
7. [Escalabilidad: del MVP a 1.000+ tiendas](#escalabilidad-del-mvp-a-1000-tiendas)
8. [Seguridad y validaciones](#seguridad-y-validaciones)
9. [Estrategia DevOps](#estrategia-devops)
10. [Limitaciones conocidas](#limitaciones-conocidas)

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Framework | React Router 7 (Remix successor) |
| Lenguaje | TypeScript |
| UI | React + Polaris + Shopify App Bridge |
| Backend (admin) | React Router actions/loaders sobre Node.js |
| Base de datos | SQLite + Prisma (dev) — diseñada para migrar a PostgreSQL en prod |
| Tracking de tráfico | Theme App Extension (app embed `target: head`) |
| Tracking de conversiones | Web Pixel Extension (no ScriptTag) |
| Billing | Shopify Billing API · `appSubscriptionCreate` + `appUsageRecordCreate` |

---

## Instalación y ejecución local

### Requisitos previos

- Node.js ≥ 20.10 y npm ≥ 10
- Cuenta de [Shopify Partners](https://partners.shopify.com/) con un development store activo
- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli) instalado globalmente: `npm install -g @shopify/cli@latest`

### Pasos

```bash
# 1. Clonar el repositorio
git clone https://github.com/JuanPi0205/interview-converxity.git
cd affiliate-commission-engine

# 2. Instalar dependencias
npm install

# 3. Inicializar la base de datos local
npx prisma migrate dev

# 4. Levantar el servidor de desarrollo
npm run dev
```

El comando `npm run dev` orquesta varios procesos en paralelo:

- React Router server (Vite)
- Bundler de la theme extension (`affiliate-tracker`)
- Bundler del web pixel (`affiliate-pixel`)
- Túnel de Cloudflare con URL pública dinámica

En el primer arranque, el CLI te guiará para vincular la app con tu Partner Dashboard y dev store. La app quedará accesible en la URL del túnel y registrada automáticamente en el admin de tu development store.

### Activar la theme extension en el storefront

Las theme app extensions requieren ser activadas manualmente por el merchant:

1. Admin Shopify → **Tienda online → Temas → Personalizar**
2. En el sidebar, click en el icono de **App embeds**
3. Activar **"Affiliate Tracker"** y guardar

### Probar el flujo end-to-end

1. Crear un afiliado en la app (ej. código `DEMO2026`, comisión 20%)
2. Visitar la storefront en incógnito: `https://affiliate-engine-dev-mcnuvfxu.myshopify.com//?ref=DEMO2026`
3. Verificar en DevTools que `affiliate_ref` quedó persistido en localStorage **y** cookie
4. Completar una compra con Bogus Gateway (número de tarjeta `1`) o Shopify Payments en modo test (`4242 4242 4242 4242`)
5. Ver la conversión en el Dashboard con badge `BILLED`

---

## Arquitectura general

```
┌─────────────────────────────────────────────────────────────────────┐
│                         STOREFRONT                                  │
│                                                                     │
│  ┌──────────────────────┐         ┌──────────────────────────────┐  │
│  │ Theme App Extension  │         │ Web Pixel Extension          │  │
│  │ (affiliate-tracker)  │         │ (affiliate-pixel)            │  │
│  │                      │         │                              │  │
│  │ ?ref=CODE            │         │ checkout_completed           │  │
│  │   ↓                  │         │   ↓                          │  │
│  │ localStorage +       │  ────▶  │ Recupera código de           │  │
│  │ cookie SameSite=Lax  │         │ cookie/localStorage          │  │
│  └──────────────────────┘         └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                              │
                                              │ POST /api/pixel/conversion
                                              │ (CORS preflight handled)
                                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      BACKEND (React Router)                         │
│                                                                     │
│  ┌──────────────────────┐                                           │
│  │ /api/pixel/conversion│                                           │
│  │                      │                                           │
│  │ 1. Idempotency check │                                           │
│  │    (pixelEventId)    │                                           │
│  │ 2. Validar afiliado  │                                           │
│  │ 3. Calcular fees     │                                           │
│  │ 4. Persistir Conversion (status=pending)                         │
│  │ 5. createUsageRecord ◀──┐                                        │
│  │ 6. Marcar billed/failed │                                        │
│  └──────────┬──────────────┘                                        │
│             │                 ┌─────────────────────────┐           │
│             │                 │ billing.server.ts       │           │
│             ▼                 │                         │           │
│  ┌──────────────────────┐     │ - Retry exponencial     │           │
│  │ SQLite (dev)         │     │ - Throttle handling     │           │
│  │ → PostgreSQL (prod)  │     │ - idempotencyKey        │           │
│  └──────────────────────┘     └─────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                              ┌───────────────────────────────┐
                              │ Shopify GraphQL Admin API     │
                              │ appUsageRecordCreate          │
                              └───────────────────────────────┘
```

### Componentes clave

| Componente | Responsabilidad |
|---|---|
| `app/routes/app.tsx` | Layout admin · billing check + auto-instalación del Web Pixel |
| `app/routes/app._index.tsx` | Dashboard con métricas agregadas |
| `app/routes/app.affiliates.*.tsx` | CRUD de afiliados (list, create, toggle) |
| `app/routes/api.pixel.conversion.ts` | Endpoint público para reportes del pixel |
| `app/billing.server.ts` | Lógica de Billing API (suscripciones + UsageRecord) |
| `app/web-pixel.server.ts` | Auto-instalación del Web Pixel via `webPixelCreate` |
| `extensions/affiliate-tracker/` | Theme extension: captura `?ref=` |
| `extensions/affiliate-pixel/` | Web Pixel: reporta `checkout_completed` |

---

## Decisiones de arquitectura

### 1. ¿Por qué React Router 7 en vez de Remix o Next.js?

React Router 7 es la evolución directa de Remix (sus equipos se fusionaron). Mantiene el modelo mental de **loaders/actions** que Shopify recomienda para apps embebidas y se alinea con el template oficial actual de `@shopify/shopify-app-react-router`. Next.js es popular pero su modelo de Server Components no encaja bien con apps embebidas — el ciclo de vida de App Bridge requiere control fino sobre client/server boundaries que React Router maneja de forma más explícita.

**Alternativas descartadas:**
- **Remix puro**: el template oficial de Shopify ya migró a React Router 7. Usar Remix sería deuda técnica de día 1.
- **Next.js App Router**: complica el manejo de App Bridge y los headers requeridos por Shopify (CSP, frame-ancestors).

### 2. ¿Por qué Web Pixel en lugar de Webhook `orders/create`?

La prueba pide explícitamente "no usar ScriptTags (Legacy)" y propone el Web Pixel. Aún así, vale documentar por qué un Webhook **no** sería suficiente:

| Aspecto | Web Pixel | Webhook `orders/create` |
|---|---|---|
| Acceso al estado del cliente (localStorage, cookies) | ✅ Sí | ❌ No |
| Sandbox de seguridad | ✅ Strict (Shopify-managed) | N/A |
| Latencia | ms (client-side) | segundos (con retries) |
| Garantía de entrega | At-most-once | At-least-once |

El Web Pixel es la única forma de **correlacionar** el código de afiliado (que vive solo en el cliente) con la orden. Un webhook server-side llegaría sin contexto del afiliado, salvo que lo persistiéramos antes en una tabla intermedia indexada por `cartToken`, lo que duplica complejidad sin ganancia clara.

**Garantía de entrega**: como el Web Pixel es at-most-once, en producción **siempre** acompañaríamos esto con un webhook `orders/create` como red de seguridad: si dentro de N minutos no llegó conversión vía pixel para una orden con `cartToken` que tenía afiliado asociado, el webhook la procesa. Para este MVP no se implementó esa redundancia, pero queda documentada.

### 3. ¿Por qué auto-instalar el Web Pixel desde la app?

Los Web Pixels **no se instalan automáticamente** al instalar la app — requieren llamar explícitamente a `webPixelCreate` con la mutación de Shopify. Lo implementé en `app/web-pixel.server.ts` con tres garantías:

1. **Idempotencia**: si ya existe, no se duplica.
2. **Auto-actualización**: si el setting `appUrl` cambió (típico en dev cuando reinicia el túnel de Cloudflare), se actualiza con `webPixelUpdate`.
3. **No bloqueante**: si falla, la app sigue funcionando — el usuario solo pierde tracking, no acceso al admin.

Se invoca desde el loader del layout `app.tsx`, dentro de un `try/catch` aislado del flujo de billing.

### 4. ¿Por qué el `appUrl` viaja como setting del pixel y no hardcoded?

El bundle del Web Pixel se compila y se sube a Shopify, **no se sirve desde nuestro backend**. Hardcodear la URL significaría:
- Recompilar y redesplegar el pixel cada vez que cambia un dominio.
- Imposible tener apps multi-instancia con URLs distintas (staging vs prod).

Pasar `appUrl` como `setting` permite que un mismo bundle funcione en múltiples entornos. La URL se inyecta en el momento de crear el pixel via `webPixelCreate`, leyendo `process.env.SHOPIFY_APP_URL`.

### 5. Captura del `?ref`: localStorage **+** cookie, no solo uno

Shopify storefronts y checkouts pueden vivir en subdominios distintos. `localStorage` no se comparte entre subdominios. Por eso persisto en ambos:

- `localStorage`: lectura rápida en storefront para debugging y para clientes recurrentes.
- `cookie` con `path=/` y `SameSite=Lax`: sobrevive al cross-subdomain y dura 30 días.

El pixel intenta cookie primero, localStorage como fallback. Si Shopify cambia su arquitectura de checkout, hay redundancia.

### 6. Toggle activo/inactivo en lugar de Delete duro

El campo `isActive` permite "soft delete" sobre el afiliado. La razón es histórica: una conversión registrada hace 6 meses sigue referenciando ese afiliado. Borrar duro rompe la integridad referencial y obliga a `ON DELETE CASCADE` que destruiría histórico. El toggle preserva data y cumple el requerimiento de "CRUD" de la prueba.

### 7. Validación de pertenencia en el endpoint del toggle

El action de `app.affiliates.$id.toggle.tsx` filtra por **`{ id, shopDomain: session.shop }`**. Sin esta validación, una tienda podría manipular afiliados de otra tienda haciendo POST con un `id` ajeno (clásico **IDOR**). Con la validación, `findFirst` devuelve null y se lanza 404.

---

## Modelo de datos y consultas críticas

### Schema simplificado

```prisma
model Affiliate {
  id              String       @id @default(cuid())
  shopDomain      String
  name            String
  code            String       // único por tienda
  commissionRate  Float        // % a pagar al afiliado
  isActive        Boolean      @default(true)
  createdAt       DateTime     @default(now())
  conversions     Conversion[]

  @@unique([shopDomain, code])  // un código no puede repetirse en la misma tienda
  @@index([shopDomain, isActive])
}

model Conversion {
  id             String   @id @default(cuid())
  shopDomain     String
  affiliateId    String
  affiliate      Affiliate @relation(fields: [affiliateId], references: [id])
  orderId        String
  orderTotal     Float
  appFee         Float    // 5% para nosotros
  affiliateFee   Float    // commissionRate% para el afiliado
  pixelEventId   String   @unique  // garantiza idempotencia
  status         String   // pending | billed | failed
  createdAt      DateTime @default(now())

  @@index([shopDomain, createdAt])
  @@index([affiliateId])
}

model BillingSubscription {
  id             String   @id @default(cuid())
  shopDomain     String   @unique
  subscriptionId String
  status         String
  cappedAmount   Float
  createdAt      DateTime @default(now())
}
```

### Justificación de índices

| Índice | Justificación |
|---|---|
| `Affiliate.@@unique([shopDomain, code])` | Garantiza que `?ref=DEMO2026` resuelve a un único afiliado por tienda. Bloquea race conditions al crear duplicados. |
| `Affiliate.@@index([shopDomain, isActive])` | El endpoint `/api/pixel/conversion` busca afiliados activos por tienda en cada conversión. Sin este índice, full table scan. |
| `Conversion.pixelEventId @unique` | Idempotencia: un mismo evento del pixel solo puede registrarse una vez, garantizado a nivel de DB (no solo aplicación). |
| `Conversion.@@index([shopDomain, createdAt])` | El Dashboard pagina conversiones recientes filtrando por tienda y ordenando por fecha. |
| `Conversion.@@index([affiliateId])` | Permite calcular comisiones acumuladas por afiliado en O(log n). |

### Migración SQLite → PostgreSQL en producción

SQLite funciona perfectamente para desarrollo (un archivo, cero configuración) pero tiene tres limitaciones críticas para producción:

1. **Un único writer concurrente**: con miles de eventos por minuto, los `db.conversion.create` se serializan y se vuelven cuello de botella.
2. **Sin replicación**: imposible escalar lecturas o sobrevivir a fallo de disco.
3. **Tipos numéricos imprecisos**: SQLite trata números como `REAL` (double-precision float), inadecuado para dinero. PostgreSQL ofrece `NUMERIC(10,2)` con precisión exacta.

Para producción migraría a **PostgreSQL gestionado en AWS RDS** (con Neon como alternativa serverless si el patrón de tráfico es muy bursty). Cambios concretos en el schema:

```prisma
// En vez de:
orderTotal Float

// Usar:
orderTotal Decimal @db.Decimal(10, 2)
```

Para volúmenes muy altos (millones de conversiones), aplicaría **partitioning declarativo** en `Conversion`:

```sql
-- Particionar por mes de createdAt
CREATE TABLE conversion (
  ...
) PARTITION BY RANGE (created_at);

CREATE TABLE conversion_2026_04 PARTITION OF conversion
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
```

Esto permite que las consultas del Dashboard (siempre acotadas por rango de fechas) tocaran solo la partición relevante, y archivar particiones viejas a S3 con `pg_dump` cuando ya no se consulten.

---

## Asincronía e idempotencia en facturación

Este es el punto más delicado del sistema. La prueba pide explícitamente sustentación.

### El problema

Cuando un cliente completa una compra:
1. El pixel envía un evento de conversión (at-most-once, sin garantía de entrega).
2. Nuestro backend debe crear un `UsageRecord` en Shopify (operación de red, puede fallar o ser throttled).
3. Si el cliente comprara dos veces el mismo producto, **deben** crearse dos `UsageRecord` distintos.
4. Si Shopify reintenta el evento (posible si hay reload del thank-you page), **no** debe crearse un cobro duplicado.

### Estrategia de idempotencia: doble llave

**Llave 1 — a nivel de DB (`Conversion.pixelEventId UNIQUE`)**
El evento del pixel trae `event.id`, generado por Shopify. Antes de procesar, consulto si ya existe. Si sí, devuelvo `200 ignored` sin efectos secundarios. Esto cubre reintentos del navegador.

**Llave 2 — a nivel de Shopify (`appUsageRecordCreate.idempotencyKey = "order-{orderId}"`)**
Aunque pasáramos el filtro de DB (race condition con dos requests llegando al mismo tiempo), Shopify tiene su propia idempotencia: dos llamadas con el mismo `idempotencyKey` retornan el mismo registro. Esto cubre nuestros propios bugs.

Las dos llaves son **complementarias**: la primera evita trabajo innecesario (DB write + llamada de red); la segunda es la red de seguridad si falla la primera.

### Estrategia de asincronía actual (MVP)

Hoy el endpoint `/api/pixel/conversion` ejecuta **síncronamente**:
1. Validar evento
2. Persistir `Conversion` con `status: pending`
3. Llamar `appUsageRecordCreate`
4. Actualizar `status: billed | failed`

El cliente del pixel queda esperando ~500ms-2s. Para MVP es aceptable porque el pixel usa `keepalive: true`, lo que sobrevive incluso si el usuario cierra el thank-you page.

### Cambios para producción a alta concurrencia

Para 1.000+ tiendas y miles de eventos/min, sincronizar es insostenible. La arquitectura de prod sería:

```
[Pixel] ──POST──▶ [API Gateway] ──▶ [Lambda thin handler]
                                          │
                                          │ 1. Persistir Conversion (status: queued)
                                          │ 2. Enviar mensaje a SQS
                                          │ 3. Devolver 202 Accepted al pixel (~50ms)
                                          ▼
                                       [SQS FIFO Queue]
                                          │ MessageGroupId = shopDomain
                                          │ MessageDeduplicationId = pixelEventId
                                          ▼
                                  [Lambda worker (poll)]
                                          │
                                          │ - createUsageRecord con retry exponencial
                                          │ - DLQ después de 3 intentos
                                          │ - Actualizar status: billed/failed
                                          ▼
                                       [PostgreSQL]
```

Decisiones clave:

- **SQS FIFO** (no Standard) por la garantía de **deduplicación nativa** vía `MessageDeduplicationId`. Triple cinturón de seguridad: DB + SQS + Shopify idempotencyKey.
- **`MessageGroupId = shopDomain`** garantiza que los eventos de una misma tienda se procesan en orden, evitando que dos workers golpeen el rate limit de Shopify para la misma tienda en paralelo.
- **DLQ (Dead Letter Queue)** captura mensajes que fallaron 3 veces. Una Lambda de monitoreo (CloudWatch alarm) avisa al equipo para investigación manual.
- **Lambda worker** en lugar de ECS: el patrón es bursty (Black Friday) y serverless escala automáticamente sin sobrepagar en horas valle.

---

## Escalabilidad: del MVP a 1.000+ tiendas

Tres ejes a considerar bajo carga: **rate limits de Shopify**, **eventos concurrentes**, **lecturas del Dashboard**.

### Eje 1: Rate limits de Shopify GraphQL

Shopify Admin API tiene un budget de costos (no requests/segundo) por tienda. Con 1.000 tiendas y miles de UsageRecords/min, el cuello de botella es **el budget por tienda individual**, no global.

**Estrategia ya implementada en `billing.server.ts`:**

```ts
for (let attempt = 0; attempt < maxRetries; attempt++) {
  // ...llamada GraphQL...
  if (userErrors[0].message?.includes("throttled")) {
    const delay = Math.pow(2, attempt) * 1000;  // 1s → 2s → 4s
    await new Promise((r) => setTimeout(r, delay));
    continue;
  }
}
```

**Mejoras para producción:**

- **Leaky bucket por tienda**: en lugar de retry pasivo, mantener un token bucket por `shopDomain` en Redis. Cada llamada consume tokens; si no hay, encolar al siguiente segundo.
- **Lectura del header `X-Shopify-API-Call-Limit`** en cada respuesta, ajustar dinámicamente el throttle.
- **Sharding de SQS por shop**: como ya mencioné, `MessageGroupId = shopDomain` serializa eventos por tienda automáticamente.

### Eje 2: Eventos concurrentes en Black Friday

Pico estimado: 10.000 eventos/min (167/s). Capacidades:

| Capa | Capacidad | Comentario |
|---|---|---|
| API Gateway | 10.000 RPS por defecto | Suficiente, escalable bajo demanda |
| Lambda thin handler | Concurrent executions: 1.000 (default) | Pedir aumento a 5.000 antes de Black Friday |
| SQS | Sin límite práctico | FIFO permite 3.000 msg/s con high throughput mode |
| RDS PostgreSQL | Limitado por conexiones | Usar **RDS Proxy** para pooling |
| Lambda worker | N concurrent x rate limit Shopify | Limitado por Shopify, no por nosotros |

**RDS Proxy** es crítico: Lambda crea conexiones nuevas en cada cold start. Sin proxy, RDS muere. Con proxy, las conexiones se reusan.

### Eje 3: Lecturas del Dashboard

El endpoint del dashboard (`app._index.tsx`) hace `aggregate` sobre `Conversion`. Con millones de filas, sin estrategia colapsa.

**Estrategia: tabla materializada + invalidación por evento.**

```sql
CREATE MATERIALIZED VIEW shop_metrics AS
SELECT
  shop_domain,
  SUM(order_total) AS total_sales,
  SUM(app_fee) AS total_app_fees,
  SUM(affiliate_fee) AS total_affiliate_fees,
  COUNT(*) AS total_conversions
FROM conversion
WHERE status = 'billed'
GROUP BY shop_domain;

CREATE UNIQUE INDEX ON shop_metrics (shop_domain);
```

Refresh con `REFRESH MATERIALIZED VIEW CONCURRENTLY` cada 5 minutos vía cron. El Dashboard lee de la vista (constante en O(1)) y muestra "última actualización hace X min" para transparencia.

Para conversiones recientes (la tabla del Dashboard) sí se consulta `Conversion` directamente, pero con `LIMIT 10` y el índice `(shopDomain, createdAt DESC)` la query es trivial.

### Estimación de costos (mental, AWS us-east-1, mes pico)

- API Gateway: 1M req/mes ≈ $3.50
- Lambda thin: 1M invocaciones × 100ms × 256MB ≈ $0.20
- SQS FIFO: 1M mensajes ≈ $0.50
- Lambda worker: 1M × 500ms × 512MB ≈ $4.50
- RDS PostgreSQL t4g.medium + RDS Proxy: ~$80/mes
- Total para Black Friday: **~$90/mes**

Estos números justifican el modelo de monetización al 5%: con un GMV procesado de $50.000/mes el margen del producto es ya saludable.

---

## Seguridad y validaciones

### Validación de pertenencia (multi-tenancy)

Todos los queries de Prisma filtran por `shopDomain: session.shop`. Esto previene IDOR (Insecure Direct Object Reference). Ejemplo en el toggle:

```ts
const affiliate = await db.affiliate.findFirst({
  where: { id, shopDomain: session.shop },  // ← guard
});
if (!affiliate) throw new Response("Not Found", { status: 404 });
```

### Sanitización de inputs

- Códigos de afiliado: `.toUpperCase().trim()` al guardar y al buscar.
- Comisión: `parseFloat` + validación `isNaN`.
- `orderTotal`: `parseFloat` antes de calcular fees.

### Endpoint público `/api/pixel/conversion`

Es el único endpoint sin autenticación de Shopify (se llama desde el sandbox del pixel). Sus mitigaciones actuales:

| Mitigación | Estado MVP | Producción |
|---|---|---|
| CORS (`Access-Control-Allow-Origin: *`) | ✅ | Restringir a `*.myshopify.com` reflejando el `Origin` |
| Idempotencia (`pixelEventId`) | ✅ | ✅ |
| Validación de afiliado activo | ✅ | ✅ |
| Rate limit por IP | ❌ | API Gateway con WAF + throttle por sourceIP |
| HMAC signature en payload | ❌ | Difícil — el pixel corre client-side, cualquier secret es público. Mejor mitigar con: cross-check contra `orders/create` webhook antes de cobrar |

La razón por la que **no** firmamos con HMAC es honesta: el bundle del Web Pixel es público (lo descarga el navegador del cliente). Cualquier secret embebido es trivialmente extraíble. La mitigación correcta es asumir que el endpoint puede recibir requests falsificados y validar contra una fuente autoritativa antes de cobrar (en producción: webhook `orders/create`).

### Manejo de secretos

- **`SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`**: en `.env` para dev, en **AWS Secrets Manager** para prod, inyectados en Lambda como variables de entorno cifradas en runtime.
- **Rotación**: Secrets Manager soporta rotación automática vía Lambda. Para Shopify estos secrets cambian raramente, rotación trimestral manual es suficiente.
- **Database URL**: stored en SSM Parameter Store con tipo `SecureString`, accedido por la app vía IAM role.

---

## Estrategia DevOps

### Gestión de entornos (dev / staging / prod)

| Entorno | Infra | Partner Dashboard | Base de datos |
|---|---|---|---|
| **dev** | Local + túnel Cloudflare | App separada por developer (`affiliate-engine-dev-juan`) | SQLite local |
| **staging** | AWS (cuenta separada) | App `affiliate-engine-staging` | RDS pequeña dedicada |
| **prod** | AWS (cuenta dedicada) | App `affiliate-engine` | RDS Multi-AZ + RDS Proxy |

Cada entorno es **una app distinta** en el Partner Dashboard. Esto se justifica porque:
- Las suscripciones de Billing son por App ID, no transferibles.
- Permite hacer cambios en el manifest de staging sin tocar prod.
- Evita que un test de QA cobre dinero de verdad a un merchant.

Variables de entorno por ambiente:
```bash
# .env.dev
SHOPIFY_APP_URL=https://*.trycloudflare.com  # dinámico
DATABASE_URL=file:./dev.sqlite

# .env.staging
SHOPIFY_APP_URL=https://staging.affiliate-engine.com
DATABASE_URL=postgresql://...staging.rds.aws.com/db

# .env.prod
SHOPIFY_APP_URL=https://app.affiliate-engine.com
DATABASE_URL=(inyectado desde Secrets Manager)
```

### Git workflow: GitHub Flow

Adopto **GitHub Flow** por su balance entre simplicidad y disciplina:

1. `main` siempre es deployable.
2. Cada feature/fix se hace en una branch (`feat/affiliate-toggle`, `fix/cors-pixel`).
3. Pull Request a `main` con CI verde + 1 review obligatorio.
4. Squash merge → deploy automático a staging.
5. Promoción manual a prod tras smoke test.

Descarté **Git Flow** (con `develop`/`release`/`hotfix`) por overhead innecesario en equipos pequeños. Descarté **Trunk-based puro** porque exige feature flags maduros, que para un MVP es prematuro.

### Pipeline CI/CD (GitHub Actions)

Workflow en `.github/workflows/deploy.yml`:

```yaml
name: CI/CD

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx prisma generate
      - run: npm run lint           # ESLint + TypeScript
      - run: npm run typecheck      # tsc --noEmit
      - run: npm run test           # Vitest unit tests
      - run: npm run build          # Vite production build

  deploy-staging:
    needs: ci
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_STAGING }}
          aws-region: us-east-1
      - run: npx prisma migrate deploy   # migraciones DB
      - run: npm run deploy:staging      # SAM/CDK deploy

  deploy-prod:
    needs: deploy-staging
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://app.affiliate-engine.com
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_PROD }}
      - run: npx prisma migrate deploy
      - run: npm run deploy:prod
```

Detalles:
- **OIDC con AWS** (`aws-actions/configure-aws-credentials`): nada de access keys de larga duración guardadas en GitHub. Cada job pide credenciales temporales vía OIDC.
- **`environment: production`** habilita aprobación manual antes del deploy a prod.
- **Migraciones de Prisma antes del deploy de la app**: si la migración falla, no se sube código que asume el nuevo schema.

### Estrategia de despliegue en AWS

- **Frontend + API**: AWS Lambda detrás de API Gateway, empaquetado con AWS SAM o CDK.
- **Workers asincrónicos**: Lambda triggered por SQS.
- **Base de datos**: RDS PostgreSQL Multi-AZ + RDS Proxy.
- **Secretos**: AWS Secrets Manager (rotación automática) + SSM Parameter Store (config no-secreta).
- **CDN**: CloudFront delante de los assets estáticos del build de Vite.
- **DNS**: Route 53 con record alias a CloudFront.

### Health checks y monitoreo

**Endpoint de health check** en `app/routes/api.health.tsx`:

```ts
export const loader = async () => {
  // Tres niveles: shallow (la lambda responde), readiness (DB OK), full (Shopify reachable)
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "ok", timestamp: Date.now() });
  } catch (e) {
    return Response.json({ status: "degraded", db: "fail" }, { status: 503 });
  }
};
```

**Monitoreo:**
- **CloudWatch Alarms** sobre métricas Lambda: errors > 1%, duration p99 > 3s, throttles > 0.
- **Custom metrics** desde el código: `MetricsLogger.putMetric("UsageRecordSuccess")` y `UsageRecordFailure`.
- **Datadog APM** (o New Relic) para distributed tracing del flujo pixel → API → SQS → Worker → Shopify.
- **PagerDuty** integrado a CloudWatch: cualquier alarma crítica notifica on-call.

### Rotación de secretos

- **Shopify API secrets**: rotación trimestral manual (Partner Dashboard → app → Reset secret). Despliegue subsecuente toma el nuevo valor de Secrets Manager.
- **DB password**: rotación automática mensual via Secrets Manager.
- **Tokens OAuth de tiendas instaladas**: gestionados por el SDK de Shopify, almacenados cifrados en DB.

---

## Limitaciones conocidas

Listo honestamente lo que **no** está cubierto en el MVP, con su mitigación de producción.

| Limitación | Mitigación en producción |
|---|---|
| Cobro síncrono al recibir el evento del pixel (latencia ~1-2s) | Mover a SQS + Lambda worker async (descrito arriba) |
| Endpoint público sin firma HMAC | Cross-check contra webhook `orders/create` antes de finalizar el cobro |
| SQLite local | PostgreSQL gestionado en RDS |
| Cookie con `SameSite=Lax`: puede fallar en checkouts con dominios externos | Usar Customer Privacy API + Checkout Extensibility en producción |
| No hay webhook `orders/create` como red de seguridad | Implementar webhook que reconcilie conversiones perdidas por el pixel |
| Aggregations directas en `Conversion` para Dashboard | Tabla materializada con refresh cada 5 min |
| Web Pixel sin retry: at-most-once | Combinar pixel + webhook como mencioné |
| Sin tests automatizados | Vitest para unit, Playwright para e2e contra dev store de QA |
| Sin observability dashboard | Datadog APM + CloudWatch Insights |

Todo lo anterior fue priorizado fuera del MVP por tiempo, no por desconocimiento.

---

## Autor

**Juan José Sánchez Pineda** · Prueba técnica para Converxity, Abril 2026.
