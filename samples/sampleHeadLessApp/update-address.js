import withSession from "lib/utils/session";
import { preparePayload } from "lib/shopify";
import { wrapApiHandlerWithSentry } from "@sentry/nextjs";

const CUSTOMER_ADDRESS_CREATE = `mutation customerAddressCreate($customerAccessToken: String!, $address: MailingAddressInput!) {
  customerAddressCreate(customerAccessToken: $customerAccessToken, address: $address) {
    customerAddress {
      id
    }
    customerUserErrors {
      code
      field
      message
    }
  }
}`;

const CUSTOMER_ADDRESS_UPDATE = `mutation customerAddressUpdate($customerAccessToken: String!, $id: ID!, $address: MailingAddressInput!) {
  customerAddressUpdate(customerAccessToken: $customerAccessToken, id: $id, address: $address) {
    customerAddress {
      id
    }
    customerUserErrors {
      code
      field
      message
    }
  }
}`;

const CUSTOMER_ADDRESS_DELETE = `mutation customerAddressDelete($id: ID!, $customerAccessToken: String!) {
  customerAddressDelete(id: $id, customerAccessToken: $customerAccessToken) {
    customerUserErrors {
      code
      field
      message
    }
    deletedCustomerAddressId
  }
}
`;

const CUSTOMER_DEFAULT_ADDRESS_UPDATE = `mutation customerDefaultAddressUpdate($customerAccessToken: String!, $addressId: ID!) {
  customerDefaultAddressUpdate(customerAccessToken: $customerAccessToken, addressId: $addressId) {
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

const CUSTOMER_QUERY = `query customerQuery($customerAccessToken: String!){
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
    orders(first:100){
      edges{
        node{
          orderNumber
          totalPrice {
            amount
            currencyCode
          }
          processedAt
          statusUrl
          successfulFulfillments(first: 100){
            trackingInfo(first: 100){
              number
              url
            }
          }
          lineItems(first:100){
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
    productwarranty: metafield(namespace: "polaroid", key: "product_warranty") {
      id
      value
    }
  }
}
`;

export default wrapApiHandlerWithSentry(
  withSession(async (req, res) => {
    if (req.method !== "POST" || !req.body) {
      // eslint-disable-next-line no-console
      console.error(
        "Wrong request method or body missing when trying to update address"
      );
      return res.status(400).end();
    }

    let input;

    try {
      input = JSON.parse(req.body);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("JSON parsing error when trying to update address:", error);
      return res.status(400).json({ error: "Bad request body" });
    }

    const payload = () => {
      switch (input.action) {
        case "CREATE":
          return preparePayload(CUSTOMER_ADDRESS_CREATE, {
            customerAccessToken: input.customerAccessToken.accessToken,
            address: input.address,
          });
        case "DEFAULT_UPDATE":
          return preparePayload(CUSTOMER_DEFAULT_ADDRESS_UPDATE, {
            customerAccessToken: input.customerAccessToken.accessToken,
            addressId: input.id,
          });
        case "UPDATE":
          return preparePayload(CUSTOMER_ADDRESS_UPDATE, {
            customerAccessToken: input.customerAccessToken.accessToken,
            id: input.id,
            address: input.address,
          });
        case "DELETE":
          return preparePayload(CUSTOMER_ADDRESS_DELETE, {
            customerAccessToken: input.customerAccessToken.accessToken,
            id: input.id,
          });
        default:
          throw new Error("No action passed");
      }
    };

    try {
      const response = await fetch(
        `https://${input.store.customStoreDomain}/api/${process.env.NEXT_PUBLIC_SHOPIFY_API_VERSION_NEW}/graphql`,
        {
          method: "POST",
          headers: input.store.storefrontConfig,
          body: JSON.stringify(payload()),
        }
      );

      const { data } = await response.json();

      const queryPayload = preparePayload(CUSTOMER_QUERY, {
        customerAccessToken: input.customerAccessToken.accessToken,
      });

      const setUpdatedCustomer = async () => {
        try {
          const customerRes = await fetch(
            `https://${input.store.customStoreDomain}/api/${process.env.NEXT_PUBLIC_SHOPIFY_API_VERSION_NEW}/graphql`,
            {
              method: "POST",
              headers: input.store.storefrontConfig,
              body: JSON.stringify(queryPayload),
            }
          );

          const { data: customerData } = await customerRes.json();

          const { customer: customerObj } = customerData;

          const { firstName, lastName, email } = customerObj;

          const customer = {
            isLoggedIn: true,
            customerAccessToken: input.customerAccessToken,
            firstName,
            lastName,
            email,
            address: data.customerAddressCreate?.customerAddress ?? null,
          };

          req.session.set("customer", customer);
          await req.session.save();

          return res.status(200).json(customer);
        } catch (err) {
          return res.status(500).json({ error: err.message });
        }
      };

      switch (input.action) {
        case "CREATE":
          // eslint-disable-next-line no-case-declarations
          const { customerAddressCreate } = data;
          if (customerAddressCreate.customerUserErrors.length > 0) {
            throw customerAddressCreate.customerUserErrors[0];
          }
          if (customerAddressCreate.customerAddress) await setUpdatedCustomer();
          break;
        case "DEFAULT_UPDATE":
          // eslint-disable-next-line no-case-declarations
          const { customerDefaultAddressUpdate } = data;
          if (customerDefaultAddressUpdate?.customerUserErrors.length > 0)
            throw customerDefaultAddressUpdate?.customerUserErrors[0];
          if (customerDefaultAddressUpdate?.customer)
            await setUpdatedCustomer();
          break;
        case "UPDATE":
          // eslint-disable-next-line no-case-declarations
          const { customerAddressUpdate } = data;
          if (customerAddressUpdate.customerUserErrors.length > 0)
            throw customerAddressUpdate.customerUserErrors[0];
          if (customerAddressUpdate.customerAddress) await setUpdatedCustomer();
          break;
        case "DELETE":
          // eslint-disable-next-line no-case-declarations
          const { customerAddressDelete } = data;
          if (customerAddressDelete.customerUserErrors.length > 0)
            throw customerAddressDelete.customerUserErrors[0];
          if (customerAddressDelete.deletedCustomerAddressId)
            await setUpdatedCustomer();
          break;

        default:
          throw new Error("No action passed");
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
    return null;
  })
);
