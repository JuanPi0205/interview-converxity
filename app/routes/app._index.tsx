import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineGrid,
  DataTable,
  EmptyState,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const conversions = await db.conversion.findMany({
    where: { shopDomain: shop },
    include: { affiliate: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const totals = await db.conversion.aggregate({
    where: { shopDomain: shop },
    _sum: {
      orderTotal: true,
      appFee: true,
      affiliateFee: true,
    },
    _count: true,
  });

  return {
    totalSales: totals._sum.orderTotal ?? 0,
    totalAppFees: totals._sum.appFee ?? 0,
    totalAffiliateFees: totals._sum.affiliateFee ?? 0,
    totalConversions: totals._count ?? 0,
    recentConversions: conversions.map((c) => ({
      id: c.id,
      affiliateCode: c.affiliate.code,
      affiliateName: c.affiliate.name,
      orderId: c.orderId,
      orderTotal: c.orderTotal,
      appFee: c.appFee,
      affiliateFee: c.affiliateFee,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
    })),
  };
};

export default function Dashboard() {
  const {
    totalSales,
    totalAppFees,
    totalAffiliateFees,
    totalConversions,
    recentConversions,
  } = useLoaderData<typeof loader>();

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);

  const rows = recentConversions.map((c) => {
    // Definimos el tono del badge basado en el estado
    const badgeTone = c.status === "billed" ? "success" : c.status === "failed" ? "critical" : "attention";

    return [
      c.affiliateCode,
      c.affiliateName,
      c.orderId.slice(-8),
      formatCurrency(c.orderTotal),
      formatCurrency(c.appFee),
      formatCurrency(c.affiliateFee),
      <Badge tone={badgeTone} key={c.id}>
        {c.status.toUpperCase()}
      </Badge>,
    ];
  });

  return (
    <Page title="Dashboard">
      <BlockStack gap="500">
        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Total Ventas Referidas
              </Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {formatCurrency(totalSales)}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {totalConversions} conversiones
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Comisiones Generadas (App)
              </Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {formatCurrency(totalAppFees)}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                5% por venta referida
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Comisiones a Pagar (Afiliados)
              </Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {formatCurrency(totalAffiliateFees)}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Según tasa del afiliado
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd" fontWeight="bold">
              Conversiones Recientes
            </Text>
            {recentConversions.length === 0 ? (
              <EmptyState
                heading="Sin conversiones aún"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Las conversiones aparecerán aquí cuando un cliente compre
                  usando un enlace de afiliado.
                </p>
              </EmptyState>
            ) : (
              <DataTable
                columnContentTypes={[
                  "text", "text", "text", "numeric", "numeric", "numeric", "text",
                ]}
                headings={[
                  "Código", "Afiliado", "Orden", "Venta", "Fee App", "Fee Afiliado", "Estado",
                ]}
                rows={rows}
              />
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}