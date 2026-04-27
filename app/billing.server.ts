import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "./db.server";

const BILLING_PLAN_NAME = "Affiliate Engine - Usage Plan";
const CAPPED_AMOUNT = 100.0;
const SERVICE_FEE_PERCENT = 0.05;

const CREATE_SUBSCRIPTION_MUTATION = `
  mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $test: Boolean!) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      lineItems: [{
        plan: {
          appUsagePricingDetails: {
            terms: "5% service fee on each referred sale"
            cappedAmount: { amount: 100.0, currencyCode: USD }
          }
        }
      }]
    ) {
      appSubscription {
        id
        status
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_ACTIVE_SUBSCRIPTION_QUERY = `
  query {
    currentAppInstallation {
      activeSubscriptions {
        id
        status
        lineItems {
          id
          plan {
            pricingDetails {
              ... on AppUsagePricing {
                cappedAmount { amount currencyCode }
                terms
              }
            }
          }
        }
      }
    }
  }
`;

const CREATE_USAGE_RECORD_MUTATION = `
  mutation AppUsageRecordCreate($subscriptionLineItemId: ID!, $price: MoneyInput!, $description: String!, $idempotencyKey: String!) {
    appUsageRecordCreate(
      subscriptionLineItemId: $subscriptionLineItemId
      price: $price
      description: $description
      idempotencyKey: $idempotencyKey
    ) {
      appUsageRecord {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function checkAndCreateSubscription(
    admin: AdminApiContext,
    shop: string,
    returnUrl: string
) {
    // Check existing subscription in our DB first
    const existing = await db.billingSubscription.findUnique({
        where: { shopDomain: shop },
    });

    if (existing && existing.status === "active") {
        return { hasSubscription: true, confirmationUrl: null };
    }

    // Verify with Shopify API
    const response = await admin.graphql(GET_ACTIVE_SUBSCRIPTION_QUERY);
    const data = await response.json();
    const activeSubscriptions =
        data.data?.currentAppInstallation?.activeSubscriptions ?? [];

    if (activeSubscriptions.length > 0) {
        const sub = activeSubscriptions[0];
        await db.billingSubscription.upsert({
            where: { shopDomain: shop },
            create: {
                shopDomain: shop,
                subscriptionId: sub.id,
                status: "active",
                cappedAmount: CAPPED_AMOUNT,
            },
            update: {
                subscriptionId: sub.id,
                status: "active",
            },
        });
        return { hasSubscription: true, confirmationUrl: null };
    }

    // No subscription — create one
    const createResponse = await admin.graphql(CREATE_SUBSCRIPTION_MUTATION, {
        variables: {
            name: BILLING_PLAN_NAME,
            returnUrl,
            test: true, // Always true for dev store
        },
    });

    const createData = await createResponse.json();
    const { appSubscription, confirmationUrl, userErrors } =
        createData.data?.appSubscriptionCreate ?? {};

    if (userErrors?.length > 0) {
        throw new Error(`Billing error: ${userErrors[0].message}`);
    }

    return { hasSubscription: false, confirmationUrl };
}

export async function createUsageRecord(
    admin: AdminApiContext,
    shop: string,
    saleAmount: number,
    orderId: string
): Promise<{ success: boolean; usageRecordId?: string; error?: string }> {
    const appFee = +(saleAmount * SERVICE_FEE_PERCENT).toFixed(2);

    // Get active subscription from Shopify to get lineItemId
    const subResponse = await admin.graphql(GET_ACTIVE_SUBSCRIPTION_QUERY);
    const subData = await subResponse.json();
    const subscriptions =
        subData.data?.currentAppInstallation?.activeSubscriptions ?? [];

    if (subscriptions.length === 0) {
        return { success: false, error: "No active subscription found" };
    }

    const subscriptionLineItemId = subscriptions[0].lineItems?.[0]?.id;
    if (!subscriptionLineItemId) {
        return { success: false, error: "No line item found in subscription" };
    }

    // Retry with exponential backoff for throttling
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await admin.graphql(CREATE_USAGE_RECORD_MUTATION, {
                variables: {
                    subscriptionLineItemId,
                    price: { amount: appFee.toString(), currencyCode: "USD" },
                    description: `5% service fee on referred sale (Order ${orderId})`,
                    idempotencyKey: `order-${orderId}`,
                },
            });

            const result = await response.json();
            const { appUsageRecord, userErrors } =
                result.data?.appUsageRecordCreate ?? {};

            if (userErrors?.length > 0) {
                // Check if throttled
                if (userErrors[0].message?.includes("throttled")) {
                    const delay = Math.pow(2, attempt) * 1000;
                    await new Promise((r) => setTimeout(r, delay));
                    continue;
                }
                return { success: false, error: userErrors[0].message };
            }

            return { success: true, usageRecordId: appUsageRecord?.id };
        } catch (error) {
            if (attempt === maxRetries - 1) {
                return { success: false, error: String(error) };
            }
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise((r) => setTimeout(r, delay));
        }
    }

    return { success: false, error: "Max retries exceeded" };
}

export { SERVICE_FEE_PERCENT, CAPPED_AMOUNT };