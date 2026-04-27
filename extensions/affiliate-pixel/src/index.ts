import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, settings }) => {
  // El appUrl se inyecta vía webPixelCreate desde la app al instalar
  const appUrl = (settings as { appUrl?: string }).appUrl;

  if (!appUrl) {
    console.error(
      "[Affiliate Engine] appUrl setting is missing. Pixel will not report conversions."
    );
    return;
  }

  analytics.subscribe("checkout_completed", async (event) => {
    try {
      // Cookie tiene prioridad: sobrevive al cross-subdomain del checkout.
      // browser.cookie.get() está disponible en runtime_context="strict".
      // Si en tests manuales no funciona, el fallback a localStorage lo cubre
      // (con la limitación de que no funcionará cross-subdomain en checkout).
      let affiliateCode: string | null = await browser.cookie.get("affiliate_ref");
      if (!affiliateCode) {
        affiliateCode = await browser.localStorage.getItem("affiliate_ref");
      }
      if (!affiliateCode) return;

      const checkout = event.data?.checkout;
      if (!checkout?.order?.id) return;

      const payload = {
        affiliateCode,
        orderId: checkout.order.id,
        orderTotal: checkout.totalPrice?.amount,
        pixelEventId: event.id,
        shopDomain: event.context.document.location.hostname,
      };

      await fetch(`${appUrl}/api/pixel/conversion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch (error) {
      console.error("[Affiliate Engine] Pixel delivery failed:", error);
    }
  });
});