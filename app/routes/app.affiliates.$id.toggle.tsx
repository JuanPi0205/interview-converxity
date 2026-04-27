import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const id = params.id as string;

    const affiliate = await db.affiliate.findFirst({
        where: { id, shopDomain: session.shop },
    });

    if (!affiliate) {
        throw new Response("Not Found", { status: 404 });
    }

    await db.affiliate.update({
        where: { id },
        data: { isActive: !affiliate.isActive },
    });

    return redirect("/app/affiliates");
};
