import withSession from "lib/utils/session";
import { preparePayload } from "lib/shopify";
import { wrapApiHandlerWithSentry } from "@sentry/nextjs";

const CUSTOMER_TOKEN_QUERY = `mutation customerAccessTokenCreate($input: CustomerAccessTokenCreateInput!) {
  customerAccessTokenCreate(input: $input) {
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
}
`;

const CUSTOMER_CREATE_QUERY = `mutation customerCreate($input: CustomerCreateInput!) {
  customerCreate(input: $input) {
    customer {
      id
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
      console.error(
        "Wrong request method or body missing when trying to register"
      );
      return res.send(400, "");
    }

    let input;

    try {
      input = JSON.parse(req.body);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("JSON parsing error when trying to register:", error);
      return res.send(400, { error: "Bad request body" });
    }

    const payload = preparePayload(CUSTOMER_CREATE_QUERY, {
      input: {
        email: input.email,
        password: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
      },
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

      const { customerCreate } = customerData;

      if (!customerCreate) {
        const error = new Error(customerRes.statusText);
        error.response = customerRes;
        error.data = customerData;
        throw error;
      }
      if (customerCreate.customerUserErrors.length > 0)
        throw customerCreate.customerUserErrors[0];

      // If that was successful lets log our new user in
      const loginPayload = preparePayload(CUSTOMER_TOKEN_QUERY, {
        input: {
          email: input.email,
          password: input.password,
        },
      });

      try {
        const tokenRes = await fetch(
          `https://${input.store.customStoreDomain}/api/${process.env.NEXT_PUBLIC_SHOPIFY_API_VERSION_NEW}/graphql`,
          {
            method: "POST",
            headers: input.store.storefrontConfig,
            body: JSON.stringify(loginPayload),
          }
        );

        const { data: tokenData } = await tokenRes.json();

        const { customerAccessTokenCreate } = tokenData;

        if (customerAccessTokenCreate.customerUserErrors.length > 0) {
          throw customerAccessTokenCreate.customerUserErrors[0];
        } else {
          const { customerAccessToken } = customerAccessTokenCreate;

          const customer = {
            isLoggedIn: true,
            customerAccessToken,
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
          };

          req.session.set("customer", customer);
          await req.session.save();
          return res.status(200).json(customer);
        }
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    } catch (error) {
      return res.status(500).json({
        error: error.message,
        errorCode: error.code,
      });
    }
  })
);
