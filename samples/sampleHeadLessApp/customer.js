import { wrapApiHandlerWithSentry } from "@sentry/nextjs";
import withAuth from "lib/utils/withAuth";

export default wrapApiHandlerWithSentry(
  withAuth(async (req, res) => {
    const customer = req.session.get("customer");

    if (customer) {
      const currentDate = new Date().getTime();
      const expireDate = new Date(
        customer.customerAccessToken.expiresAt
      ).getTime();

      if (expireDate <= currentDate) {
        req.session.destroy();
        res.json({ isLoggedIn: false });
      }

      res.json({ isLoggedIn: true, ...customer });
    } else {
      res.json({ isLoggedIn: false });
    }
  })
);
