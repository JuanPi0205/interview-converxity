import type { HeadersFunction, LoaderFunctionArgs, LinksFunction } from "react-router";
import { Outlet, useLoaderData, useRouteError, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import translations from "@shopify/polaris/locales/es.json";
import { useEffect } from "react";

import { authenticate } from "../shopify.server";
import { checkAndCreateSubscription } from "../billing.server";
import { ensureWebPixelInstalled } from "../web-pixel.server";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "ui-nav-menu": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: polarisStyles },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  let confirmationUrl: string | null = null;

  // Bloque 1: Billing — verificar/crear suscripción
  try {
    const shopName = session.shop.replace(".myshopify.com", "");
    const returnUrl = `https://admin.shopify.com/store/${shopName}/apps/${process.env.SHOPIFY_API_KEY}`;

    const result = await checkAndCreateSubscription(
      admin,
      session.shop,
      returnUrl
    );

    // ⚠️ NO hagas throw redirect aquí. Pasa la URL al cliente
    // para que App Bridge haga el redirect top-level vía postMessage.
    if (!result.hasSubscription && result.confirmationUrl) {
      confirmationUrl = result.confirmationUrl;
    }
  } catch (error: unknown) {
    if (error instanceof Response) throw error;
    console.warn("[Billing] Skipped:", (error as Error).message);
  }

  // Bloque 2: Web Pixel — instalar/actualizar para tracking de conversiones
  // Aislado en su propio try/catch: si falla, no debe bloquear la app
  try {
    await ensureWebPixelInstalled(admin);
  } catch (error) {
    console.warn("[WebPixel] Skipped:", (error as Error).message);
  }

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    confirmationUrl,
  };
};

export default function App() {
  const { apiKey, confirmationUrl } = useLoaderData<typeof loader>();

  useEffect(() => {
    if (!confirmationUrl) return;

    // App Bridge sobreescribe window.open cuando AppProvider embedded está montado.
    // window.open(url, "_top") atraviesa el iframe vía postMessage al admin.
    // Esperamos un tick para asegurar que App Bridge ya esté inicializado.
    const doRedirect = () => {
      if ((window as any).shopify) {
        window.open(confirmationUrl, "_top");
      } else {
        // App Bridge aún no listo — reintenta en el siguiente tick
        setTimeout(doRedirect, 50);
      }
    };

    doRedirect();
  }, [confirmationUrl]);

  // Vista de "redirigiendo..." mientras App Bridge hace el navigate
  if (confirmationUrl) {
    return (
      <AppProvider embedded apiKey={apiKey}>
        <PolarisAppProvider i18n={translations}>
          <div style={{ padding: "2rem", textAlign: "center" }}>
            Redirigiendo a la página de aprobación de plan...
          </div>
        </PolarisAppProvider>
      </AppProvider>
    );
  }

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={translations}>
        <ui-nav-menu>
          <Link to="/app" rel="home">Dashboard</Link>
          <Link to="/app/affiliates">Afiliados</Link>
        </ui-nav-menu>
        <Outlet />
      </PolarisAppProvider>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};