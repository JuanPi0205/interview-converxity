import { useLoaderData, useNavigate, Form } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Page, Card, IndexTable, Text, Badge, EmptyState, Button } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);

    // Obtenemos los afiliados ordenados por los más recientes
    const affiliates = await db.affiliate.findMany({
        where: { shopDomain: session.shop },
        orderBy: { createdAt: "desc" },
    });

    return { affiliates };
};

export default function AffiliatesList() {
    const { affiliates } = useLoaderData<typeof loader>();
    const navigate = useNavigate();

    const rowMarkup = affiliates.map(
        ({ id, code, name, commissionRate, isActive }, index) => (
            <IndexTable.Row id={id} key={id} position={index}>
                <IndexTable.Cell>
                    <Text variant="bodyMd" fontWeight="bold" as="span">
                        {name}
                    </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                    <Text as="span" tone="subdued">
                        {code}
                    </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>{commissionRate}%</IndexTable.Cell>
                <IndexTable.Cell>
                    <Badge tone={isActive ? "success" : "critical"}>
                        {isActive ? "Activo" : "Inactivo"}
                    </Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                    <Form method="post" action={`/app/affiliates/${id}/toggle`}>
                        <Button submit variant="plain">
                            {isActive ? "Desactivar" : "Activar"}
                        </Button>
                    </Form>
                </IndexTable.Cell>
            </IndexTable.Row>
        )
    );

    return (
        <Page
            title="Afiliados"
            primaryAction={{
                content: "Crear afiliado",
                onAction: () => navigate("/app/affiliates/new"),
            }}
        >
            <Card padding="0">
                {affiliates.length === 0 ? (
                    <EmptyState
                        heading="Gestiona tus afiliados"
                        action={{
                            content: "Crear primer afiliado",
                            onAction: () => navigate("/app/affiliates/new"),
                        }}
                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                        <p>Crea enlaces de tracking únicos y define comisiones personalizadas.</p>
                    </EmptyState>
                ) : (
                    <IndexTable
                        resourceName={{ singular: "afiliado", plural: "afiliados" }}
                        itemCount={affiliates.length}
                        headings={[
                            { title: "Nombre" },
                            { title: "Código de Tracking" },
                            { title: "Comisión" },
                            { title: "Estado" },
                            { title: "Acciones" },
                        ]}
                        selectable={false}
                    >
                        {rowMarkup}
                    </IndexTable>
                )}
            </Card>
        </Page>
    );
}