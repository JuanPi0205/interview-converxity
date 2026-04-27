import { useState } from "react";
import { redirect, useActionData, useSubmit, useNavigate } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import {
    Page,
    Card,
    FormLayout,
    TextField,
    BlockStack,
    PageActions,
    Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();

    const name = formData.get("name") as string;
    const code = formData.get("code") as string;
    const commissionRate = parseFloat(formData.get("commissionRate") as string);

    if (!name || !code || isNaN(commissionRate)) {
        return { error: "Todos los campos son obligatorios y la comisión debe ser válida." };
    }

    const cleanCode = code.toUpperCase().trim();

    // Validación: Garantizar que el código sea único por tienda
    const existing = await db.affiliate.findFirst({
        where: { shopDomain: session.shop, code: cleanCode },
    });

    if (existing) {
        return { error: `El código "${cleanCode}" ya está en uso. Por favor, elige otro.` };
    }

    await db.affiliate.create({
        data: {
            shopDomain: session.shop,
            name,
            code: cleanCode,
            commissionRate,
            isActive: true,
        },
    });

    return redirect("/app/affiliates");
};

export default function NewAffiliate() {
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigate = useNavigate();

    const [name, setName] = useState("");
    const [code, setCode] = useState("");
    const [commissionRate, setCommissionRate] = useState("10");

    const handleSave = () => {
        const data = new FormData();
        data.append("name", name);
        data.append("code", code);
        data.append("commissionRate", commissionRate);
        submit(data, { method: "post" });
    };

    return (
        <Page
            backAction={{ content: "Afiliados", onAction: () => navigate("/app/affiliates") }}
            title="Crear nuevo afiliado"
        >
            <BlockStack gap="500">
                {actionData?.error && (
                    <Banner title="Ocurrió un error" tone="critical">
                        <p>{actionData.error}</p>
                    </Banner>
                )}

                <Card>
                    <FormLayout>
                        <TextField
                            label="Nombre del Afiliado"
                            value={name}
                            onChange={setName}
                            autoComplete="off"
                            helpText="Ej: Creador Tech, Influencer Moda..."
                        />
                        <TextField
                            label="Código de Tracking"
                            value={code}
                            onChange={setCode}
                            autoComplete="off"
                            helpText="El identificador único para la URL (ej: PROMO2026). Se guardará en mayúsculas."
                        />
                        <TextField
                            label="Porcentaje de Comisión (%)"
                            type="number"
                            value={commissionRate}
                            onChange={setCommissionRate}
                            autoComplete="off"
                            helpText="Porcentaje de la venta que se le pagará al afiliado por referir."
                        />
                    </FormLayout>
                </Card>

                <PageActions
                    primaryAction={{
                        content: "Guardar afiliado",
                        onAction: handleSave,
                        disabled: !name || !code || !commissionRate,
                    }}
                    secondaryActions={[
                        {
                            content: "Cancelar",
                            onAction: () => navigate("/app/affiliates"),
                        },
                    ]}
                />
            </BlockStack>
        </Page>
    );
}