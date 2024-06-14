import withSession from "lib/utils/session";
import { preparePayload } from "lib/shopify";
import { wrapApiHandlerWithSentry } from "@sentry/nextjs";

const CUSTOMER_ACTIVATE_QUERY = `mutation customerActivate($id: ID!, $input: CustomerActivateInput!) {
  customerActivate(id: $id, input: $input) {
    customer {
      id
      firstName
      lastName
      email
      acceptsMarketing
    }
    customerAccessToken {
      accessToken
      expiresAt
    }
    customerUserErrors {
      code
      field
      message
    }
  }
}`;

export default wrapApiHandlerWithSentry(
  withSession(async (req, res) => {
    if (req.method !== "POST" || !req.body) {
      // eslint-disable-next-line no-console
      console.error("Http error when trying to activate account");
      return res
        .status(400)
        .json({ error: "Http error when trying to activate account" });
    }

    let input;
    try {
      input = req.body;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        "JSON parsing error when trying to activate account:",
        error
      );
      return res
        .status(400)
        .json({ error: "Bad request body when trying to activate account" });
    }

    const payload = preparePayload(CUSTOMER_ACTIVATE_QUERY, {
      id: input.id,
      input: input.input,
    });

    try {
      const customerRes = await fetch(
        `https://${input.store.customStoreDomain}/api/${process.env.NEXT_PUBLIC_SHOPIFY_API_VERSION_NEW}/graphql`,
        {
          method: "POST",
          headers: input.store.storefrontConfig,
          body: JSON.stringify(payload),
        }
      );

      const { data: customerData } = await customerRes.json();

      const { customerActivate } = customerData;

      if (customerActivate?.customerUserErrors?.length > 0) {
        throw customerActivate.customerUserErrors[0];
      }
      if (
        !customerActivate?.customer ||
        !customerActivate?.customerAccessToken
      ) {
        return res.status(400).json({
          error: "Customer not found when trying to activate customer",
        });
      }

      const customer = {
        isLoggedIn: true,
        customerAccessToken: customerActivate.customerAccessToken,
        ...customerActivate.customer,
      };

      req.session.set("customer", customer);
      await req.session.save();
      return res.status(200).json(customer);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  })
);
