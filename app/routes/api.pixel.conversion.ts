import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { createUsageRecord } from "../billing.server";

// Headers CORS reusables — todas las respuestas del endpoint los incluyen.
// "*" es aceptable porque el endpoint es idempotente y no usa cookies de sesión;
// para producción podríamos restringir a *.myshopify.com via reflexión del Origin.
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

// React Router invoca `loader` para GET y OPTIONS. Aquí solo respondemos
// el preflight CORS (OPTIONS) — los GET no son parte de la API pública.
export const loader = async ({ request }: LoaderFunctionArgs) => {
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    return new Response("Method not allowed", { status: 405 });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    if (request.method !== "POST") {
        return Response.json(
            { error: "Method not allowed" },
            { status: 405, headers: CORS_HEADERS }
        );
    }

    const body = await request.json();
    const { affiliateCode, orderId, orderTotal, pixelEventId, shopDomain } = body;

    if (!affiliateCode || !orderId || !shopDomain) {
        return Response.json(
            { error: "Missing required fields" },
            { status: 400, headers: CORS_HEADERS }
        );
    }

    const existingConversion = await db.conversion.findUnique({
        where: { pixelEventId },
    });

    if (existingConversion) {
        return Response.json(
            { message: "Event already processed", status: "ignored" },
            { headers: CORS_HEADERS }
        );
    }

    const affiliate = await db.affiliate.findFirst({
        where: { code: affiliateCode, shopDomain },
    });

    if (!affiliate || !affiliate.isActive) {
        return Response.json(
            { error: "Affiliate not found or inactive" },
            { status: 404, headers: CORS_HEADERS }
        );
    }

    const amount = parseFloat(orderTotal);
    const appFee = +(amount * 0.05).toFixed(2);
    const affiliateFee = +(amount * (affiliate.commissionRate / 100)).toFixed(2);

    const conversion = await db.conversion.create({
        data: {
            shopDomain,
            affiliateId: affiliate.id,
            orderId: String(orderId),
            orderTotal: amount,
            appFee,
            affiliateFee,
            pixelEventId,
            status: "pending",
        },
    });

    try {
        const { admin } = await unauthenticated.admin(shopDomain);
        const billingResult = await createUsageRecord(admin, shopDomain, amount, String(orderId));

        if (billingResult.success) {
            await db.conversion.update({
                where: { id: conversion.id },
                data: { status: "billed" },
            });
        } else {
            await db.conversion.update({
                where: { id: conversion.id },
                data: { status: "failed" },
            });
            console.error("[Billing Error]", billingResult.error);
        }
    } catch (error) {
        console.error("[Background Error]", error);
        await db.conversion.update({
            where: { id: conversion.id },
            data: { status: "failed" },
        });
    }

    return Response.json(
        { success: true, conversionId: conversion.id },
        { headers: CORS_HEADERS }
    );
};