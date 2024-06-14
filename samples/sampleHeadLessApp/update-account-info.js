import withSession from "lib/utils/session";
import { preparePayload } from "lib/shopify";
import { wrapApiHandlerWithSentry } from "@sentry/nextjs";

const CUSTOMER_UPDATE = `mutation customerUpdate($customerAccessToken: String!, $customer: CustomerUpdateInput!) {
  customerUpdate(customerAccessToken: $customerAccessToken, customer: $customer) {
    customer {
      id
    }
    # Note: only when password is updated will a new access token be returned
    # customerAccessToken {
    #   accessToken
    #   expiresAt
    # }
    customerUserErrors {
      code
      field
      message
    }
  }
}`;

const CUSTOMER_ADDRESS_QUERY = `
  id
  firstName
  lastName
  address1
  address2
  company
  phone
  city
  country
  province
  zip
`;

const CUSTOMER_QUERY = `query customerQuery($customerAccessToken: String!) {
  customer(customerAccessToken: $customerAccessToken) {
    firstName
    lastName
    acceptsMarketing
    phone
    email
    tags
    defaultAddress {
      ${CUSTOMER_ADDRESS_QUERY}
    }
    addresses(first: 100) {
      edges {
        node {
          ${CUSTOMER_ADDRESS_QUERY}
        }
      }
    }
    orders(first:100) {
      edges{
        node{
          orderNumber
          totalPrice {
            amount
            currencyCode
          }
          processedAt
          statusUrl
          successfulFulfillments(first: 100) {
            trackingInfo(first: 100) {
              number
              url
            }
          }
          lineItems(first:100) {
            edges{
              node{
                customAttributes {
                  key
                  value
                }
                quantity
                title
                variant {
                  title
                  price {
                    amount
                    currencyCode
                  }
                  image {
                    originalSrc
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

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
  }`;

export default wrapApiHandlerWithSentry(
  withSession(async (req, res) => {
    if (req.method !== "POST" || !req.body) {
      // eslint-disable-next-line no-console
      console.error(
        "Wrong request method or body missing when trying to update account information"
      );
      return res.status(400).end();
    }

    let input;
    let newCustomerAccessToken;

    try {
      input = JSON.parse(req.body);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        "JSON parsing error when trying to update account information:",
        error
      );
      return res.status(400).json({ error: "Bad request body" });
    }

    const payload = preparePayload(CUSTOMER_UPDATE, {
      customerAccessToken: input.customerAccessToken.accessToken,
      customer: input.customer,
    });

    try {
      const updateRes = await fetch(
        `https://${input.store.customStoreDomain}/api/${process.env.NEXT_PUBLIC_SHOPIFY_API_VERSION_NEW}/graphql`,
        {
          method: "POST",
          headers: input.store.storefrontConfig,
          body: JSON.stringify(payload),
        }
      );

      const { data: updateData } = await updateRes.json();

      const { customerUpdate } = updateData;

      if (customerUpdate?.customerUserErrors?.length > 0)
        throw customerUpdate.customerUserErrors[0];
      if (!customerUpdate?.customer) {
        // eslint-disable-next-line no-console
        console.error(
          "Bad request: Customer not found when trying to update account information"
        );
        return res.status(400).json({
          error: "Customer not found when trying to update account information",
        });
      }

      // if customer update is successful, check if password is updated
      // if password is not updated, skip this step
      // if password is updated, shopify will generate a new customer access token we need to query
      if (input?.customer.password) {
        const tokenQueryPayload = preparePayload(CUSTOMER_TOKEN_QUERY, {
          input: {
            email: input?.customer.email,
            password: input?.customer.password,
          },
        });

        try {
          const tokenRes = await fetch(
            `https://${input.store.customStoreDomain}/api/${process.env.NEXT_PUBLIC_SHOPIFY_API_VERSION_NEW}/graphql`,
            {
              method: "POST",
              headers: input.store.storefrontConfig,
              body: JSON.stringify(tokenQueryPayload),
            }
          );

          const { data: tokenData } = await tokenRes.json();

          const { customerAccessTokenCreate } = tokenData;

          if (customerAccessTokenCreate.customerUserErrors.length > 0) {
            throw customerAccessTokenCreate.customerUserErrors[0];
          }
          if (!customerAccessTokenCreate.customerAccessToken) {
            const error = new Error(tokenRes.statusText);
            error.response = tokenRes;
            error.data = tokenData;
            throw error;
          }
          newCustomerAccessToken =
            customerAccessTokenCreate.customerAccessToken;
        } catch (err) {
          res.status(500).json({ error: "Problem with email or password" });
        }
      }

      // query our updated customer
      const customerQueryPayload = preparePayload(CUSTOMER_QUERY, {
        customerAccessToken: input?.customer.password
          ? newCustomerAccessToken.accessToken
          : input.customerAccessToken.accessToken,
      });

      try {
        const customerRes = await fetch(
          `https://${input.store.customStoreDomain}/api/${process.env.NEXT_PUBLIC_SHOPIFY_API_VERSION_NEW}/graphql`,
          {
            method: "POST",
            headers: input.store.storefrontConfig,
            body: JSON.stringify(customerQueryPayload),
          }
        );

        const { data: customerData } = await customerRes.json();

        const { customer: customerObj } = customerData;

        const { firstName, lastName, email } = customerObj;

        const customer = {
          isLoggedIn: true,
          customerAccessToken: input?.customer.password
            ? newCustomerAccessToken
            : input.customerAccessToken,
          firstName,
          lastName,
          email,
        };

        req.session.set("customer", customer);
        await req.session.save();
        return res.status(200).json(customer);
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      return res.status(500).json({ error: error.message });
    }
  })
);
