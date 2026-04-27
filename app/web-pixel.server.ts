import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const CREATE_WEB_PIXEL_MUTATION = `
  mutation webPixelCreate($webPixel: WebPixelInput!) {
    webPixelCreate(webPixel: $webPixel) {
      webPixel {
        id
        settings
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_WEB_PIXEL_MUTATION = `
  mutation webPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
    webPixelUpdate(id: $id, webPixel: $webPixel) {
      webPixel {
        id
        settings
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_WEB_PIXEL_QUERY = `
  query {
    webPixel {
      id
      settings
    }
  }
`;

export async function ensureWebPixelInstalled(admin: AdminApiContext) {
    const appUrl = process.env.SHOPIFY_APP_URL;

    if (!appUrl) {
        console.warn("[WebPixel] SHOPIFY_APP_URL not set, skipping pixel install");
        return;
    }

    const desiredSettings = JSON.stringify({ appUrl });

    // Verificar si ya está instalado
    const checkResponse = await admin.graphql(GET_WEB_PIXEL_QUERY);
    const checkData = await checkResponse.json();
    const existingPixel = checkData.data?.webPixel;

    if (existingPixel) {
        // Ya existe — verificar si la URL coincide
        if (existingPixel.settings === desiredSettings) {
            return; // Todo en orden
        }

        // La URL cambió (típico en dev con túnel de Cloudflare) — actualizar
        const updateResponse = await admin.graphql(UPDATE_WEB_PIXEL_MUTATION, {
            variables: {
                id: existingPixel.id,
                webPixel: { settings: desiredSettings },
            },
        });
        const updateData = await updateResponse.json();
        const updateErrors = updateData.data?.webPixelUpdate?.userErrors ?? [];
        if (updateErrors.length > 0) {
            console.error("[WebPixel] Update error:", updateErrors);
        } else {
            console.log("[WebPixel] Pixel settings updated");
        }
        return;
    }

    // No existe — crear
    const createResponse = await admin.graphql(CREATE_WEB_PIXEL_MUTATION, {
        variables: {
            webPixel: { settings: desiredSettings },
        },
    });
    const createData = await createResponse.json();
    const createErrors = createData.data?.webPixelCreate?.userErrors ?? [];

    if (createErrors.length > 0) {
        if (createErrors[0].message?.toLowerCase().includes("taken")) {
            // Race condition: otro request ya lo creó
            return;
        }
        console.error("[WebPixel] Create error:", createErrors);
        return;
    }

    console.log("[WebPixel] Pixel installed successfully");
}