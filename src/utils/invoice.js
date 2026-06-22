const fs = require("fs");
const path = require("path");
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

let cachedLogoDataUri = null;

const CHROME_ENV_KEYS = [
  "PUPPETEER_EXECUTABLE_PATH",
  "CHROME_EXECUTABLE_PATH",
  "GOOGLE_CHROME_BIN",
];

const getEnvChromeExecutablePath = () => {
  for (const key of CHROME_ENV_KEYS) {
    const value = process.env[key];
    if (value && fs.existsSync(value)) return value;
  }

  return null;
};

const getLocalChromeExecutablePath = () => {
  const candidates =
    process.platform === "win32"
      ? [
          path.join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
          path.join(
            process.env["PROGRAMFILES(X86)"] || "",
            "Google/Chrome/Application/chrome.exe"
          ),
          path.join(
            process.env.LOCALAPPDATA || "",
            "Google/Chrome/Application/chrome.exe"
          ),
        ]
      : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : [
          "/usr/bin/google-chrome-stable",
          "/usr/bin/google-chrome",
          "/usr/bin/chromium-browser",
          "/usr/bin/chromium",
        ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
};

const isServerlessRuntime = () =>
  Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.AWS_EXECUTION_ENV
  );

const getInvoiceBrowserLaunchOptions = async () => {
  const executablePath = getEnvChromeExecutablePath() || getLocalChromeExecutablePath();

  if (executablePath) {
    return {
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    };
  }

  if (isServerlessRuntime()) {
    return {
      args: puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: "shell",
    };
  }

  return {
    channel: "chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };
};

const formatMoney = (value) => {
  const amount = Number(value || 0);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
};

const formatDate = (value) => {
  if (!value) return "N/A";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const getOrderNumber = (order) =>
  order?.orderNumber ? `#${order.orderNumber}` : `#${String(order?._id || "").slice(-8)}`;

const getProductName = (item) => item?.product?.productName || item?.name || "Product";

const getInvoiceSku = (item) => item?.product?.sku || item?.sku || "N/A";

const getSellerName = (item) =>
  item?.seller?.name || item?.product?.creator?.name || "Cartout Seller";

const getSellerHeaderName = (order) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const sellerNames = [
    ...new Set(items.map((item) => getSellerName(item)).filter(Boolean)),
  ];

  if (sellerNames.length === 1) return sellerNames[0];
  return sellerNames.length > 1 ? "Multiple Sellers" : "Seller Name";
};

const formatVariantAttributes = (attributes) => {
  if (!attributes) return "N/A";

  const normalized =
    attributes instanceof Map
      ? Object.fromEntries(attributes)
      : typeof attributes.toObject === "function"
      ? attributes.toObject()
      : attributes;

  const parts = Object.entries(normalized)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${value}`);

  return parts.length ? parts.join(", ") : "N/A";
};

const getItemVariant = (item) => {
  const variants = item?.product?.variants;

  if (!Array.isArray(variants)) return null;

  return variants.find(
    (variant) => variant?._id?.toString() === item?.variant?.toString()
  );
};

const getRegularUnitPrice = (item) => {
  const savedRegularPrice = Number(item?.regularPrice);

  if (Number.isFinite(savedRegularPrice) && savedRegularPrice > 0) {
    return savedRegularPrice;
  }

  const variantRegularPrice = Number(getItemVariant(item)?.price);

  if (Number.isFinite(variantRegularPrice) && variantRegularPrice > 0) {
    return variantRegularPrice;
  }

  return Number(item?.price || 0);
};

const getPaidUnitPrice = (item) => {
  const paidPrice = Number(item?.price);

  if (Number.isFinite(paidPrice) && paidPrice > 0) {
    return paidPrice;
  }

  const variant = getItemVariant(item);
  const discountPrice = Number(variant?.discountPrice);

  if (Number.isFinite(discountPrice) && discountPrice > 0) {
    return discountPrice;
  }

  return getRegularUnitPrice(item);
};

const formatAddress = (address) => {
  if (!address) return "Address not available";

  const parts =
    address.division || address.district || address.upazila || address.area
      ? [
          address.street,
          address.area,
          address.upazila,
          address.district,
          address.division,
          address.country,
        ]
      : [
          address.street,
          address.city,
          address.state,
          address.postalCode,
          address.country,
        ];

  return parts.filter(Boolean).join(", ");
};

const getLogoDataUri = () => {
  if (cachedLogoDataUri !== null) return cachedLogoDataUri;

  const logoPath =
    process.env.INVOICE_LOGO_PATH ||
    path.resolve(__dirname, "../../../client/public/images/cartout.png");

  try {
    if (fs.existsSync(logoPath)) {
      cachedLogoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
      return cachedLogoDataUri;
    }
  } catch (error) {
    cachedLogoDataUri = "";
    return cachedLogoDataUri;
  }

  cachedLogoDataUri = "";
  return cachedLogoDataUri;
};

const buildInvoiceEmailHtml = (order) => {
  const customerName = order?.customer?.name || order?.user?.name || "Customer";

  return `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
      <h2 style="margin: 0 0 8px; color: #ff3300;">Your Cartout invoice is ready</h2>
      <p>Hi ${escapeHtml(customerName)},</p>
      <p>Thanks for your order ${escapeHtml(getOrderNumber(order))}. Your invoice PDF is attached with this email.</p>
      <p style="font-size: 13px; color: #6b7280;">Please download the attached PDF to view or save your invoice.</p>
    </div>
  `;
};

const buildInvoiceHtml = (order, options = {}) => {
  const customerName = order?.customer?.name || order?.user?.name || "Customer";
  const customerEmail = order?.customer?.email || order?.user?.email || "N/A";
  const customerPhone = order?.customer?.phone || "N/A";
  const items = Array.isArray(order?.items) ? order.items : [];
  const subtotal = Number(order?.totalAmount || 0);
  const shippingFee = Number(order?.shippingFee || 0);
  const payableAmount = Number(order?.payableAmount || subtotal + shippingFee);
  const discount = Number(order?.discount || order?.discountAmount || 0);
  const advance = Number(order?.advance || order?.advanceAmount || 0);
  const codAmount = Math.max(payableAmount - advance, 0);
  const sellerName = getSellerHeaderName(order);
  const logoDataUri = getLogoDataUri();
  const logoMarkup = logoDataUri
    ? `<img src="${logoDataUri}" alt="CartOut" />`
    : `<div class="cart-icon" aria-hidden="true"></div><strong>CartOut</strong><small>Aunit to Cart And Checkout</small>`;
  const scopeLabel = options.scopeLabel
    ? `<span class="scope-label">${escapeHtml(options.scopeLabel)}</span>`
    : "";

  const rows = items
    .map((item, index) => {
      const quantity = Number(item.quantity || 0);
      const regularPrice = getRegularUnitPrice(item);
      const paidPrice = getPaidUnitPrice(item);
      const total = regularPrice * quantity;

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(getProductName(item))}</td>
          <td>${escapeHtml(getInvoiceSku(item))}</td>
          <td>${escapeHtml(formatVariantAttributes(item.attributes))}</td>
          <td>${formatMoney(regularPrice)}</td>
          <td>${quantity}</td>
          <td>${formatMoney(total)}</td>
          <td>${formatMoney(paidPrice)}</td>
        </tr>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Invoice ${escapeHtml(getOrderNumber(order))}</title>
    <style>
      @page {
        size: A4;
        margin: 0;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        background: #ffffff;
        color: #222222;
        font-family: Arial, Helvetica, sans-serif;
      }
      .invoice-sheet {
        width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        padding: 11mm 12mm 8mm;
        background: #ffffff;
        position: relative;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: stretch;
        min-height: 27mm;
        border: 1px solid #111111;
        background: #ffcc42;
      }
      .header-left {
        display: flex;
        align-items: center;
        gap: 6mm;
        padding: 3mm 4mm;
      }
      .placeholder {
        width: 22mm;
        height: 22mm;
        border: 2px solid #111111;
        background: #ffffff;
        position: relative;
        flex: 0 0 auto;
      }
      .placeholder::before,
      .placeholder::after {
        content: "";
        position: absolute;
        left: 4mm;
        right: 4mm;
        top: 10mm;
        border-top: 2px solid #111111;
        transform: rotate(-42deg);
      }
      .placeholder::after {
        transform: rotate(42deg);
      }
      .placeholder span {
        position: absolute;
        left: 5mm;
        top: 6mm;
        width: 11mm;
        height: 9mm;
        border: 2px solid #111111;
        border-radius: 1mm;
        background: #ffffff;
      }
      .header-copy h1 {
        margin: 1mm 0 1mm;
        font-size: 22px;
        line-height: 1;
        font-weight: 400;
      }
      .header-copy p {
        margin: 0.8mm 0;
        font-size: 13px;
        line-height: 1.15;
      }
      .scope-label {
        display: inline-block;
        margin-left: 2mm;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
      }
      .brand-mark {
        width: 28mm;
        border-left: 1px solid #111111;
        display: grid;
        place-items: center;
        padding: 2mm 1.5mm;
        text-align: center;
      }
      .brand-mark img {
        display: block;
        width: 24mm;
        height: auto;
        max-height: 22mm;
        object-fit: contain;
      }
      .cart-icon {
        width: 18mm;
        height: 12mm;
        border: 3px solid #111111;
        border-top: 0;
        transform: skewX(-12deg);
        margin: 0 auto 1mm;
        position: relative;
      }
      .cart-icon::before {
        content: "";
        position: absolute;
        width: 8mm;
        border-top: 3px solid #111111;
        left: -6mm;
        top: 0;
        transform: rotate(22deg);
      }
      .cart-icon::after {
        content: "";
        position: absolute;
        left: 2mm;
        right: 2mm;
        bottom: -5mm;
        height: 4mm;
        border-left: 3px solid #111111;
        border-right: 3px solid #111111;
      }
      .brand-mark strong {
        display: block;
        font-size: 15px;
        line-height: 1;
      }
      .brand-mark small {
        display: block;
        font-size: 5.8px;
        line-height: 1.15;
      }
      h2 {
        margin: 5mm 0 3.5mm;
        font-size: 17px;
        line-height: 1;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      .details td,
      .items th,
      .items td,
      .totals td {
        border: 1px solid #111111;
      }
      .details td {
        height: 9.5mm;
        padding: 2.2mm;
        font-size: 13px;
        line-height: 1.25;
        overflow-wrap: anywhere;
        vertical-align: middle;
      }
      .details .label {
        width: 24%;
        font-weight: 700;
        white-space: nowrap;
      }
      .details .value {
        width: 26%;
        white-space: normal;
      }
      .items th {
        height: 14.5mm;
        padding: 2mm 1.5mm;
        font-size: 13px;
        line-height: 1.15;
        text-align: center;
        vertical-align: middle;
        font-weight: 700;
      }
      .items td {
        min-height: 11mm;
        padding: 2mm 1.5mm;
        font-size: 13px;
        line-height: 1.25;
        text-align: center;
        vertical-align: middle;
        overflow-wrap: anywhere;
      }
      .items td:nth-child(2),
      .items td:nth-child(3) {
        word-break: break-word;
      }
      .items .empty-row td {
        height: 10mm;
      }
      .totals-wrap {
        width: 42%;
        margin-left: auto;
      }
      .totals td {
        height: 9.5mm;
        padding: 2mm 2.2mm;
        font-size: 13px;
        line-height: 1.25;
      }
      .totals .total-label {
        width: 50%;
      }
      .totals .amount {
        width: 50%;
        text-align: right;
      }
      .totals .cod td {
        font-weight: 700;
      }
      .footer-note {
        position: absolute;
        left: 12mm;
        right: 12mm;
        bottom: 8mm;
        border-top: 1px solid #999999;
        padding-top: 3mm;
        color: #666666;
        font-size: 8px;
        line-height: 1.25;
        text-align: center;
      }
      @media screen {
        body {
          background: #f0f0f0;
        }
        .invoice-sheet {
          box-shadow: 0 1mm 4mm rgba(0, 0, 0, 0.15);
        }
      }
      @media print {
        .invoice-sheet {
          box-shadow: none;
        }
      }
    </style>
  </head>
  <body>
    <main class="invoice-sheet">
      <section class="header">
        <div class="header-left">
          <div class="placeholder" aria-hidden="true"><span></span></div>
          <div class="header-copy">
            <h1>Seller Center</h1>
            <p>Purchase Summary ${scopeLabel}</p>
            <p>${escapeHtml(sellerName)}</p>
          </div>
        </div>
        <div class="brand-mark">
          <div>
            ${logoMarkup}
          </div>
        </div>
      </section>

      <h2>Order Details:</h2>
      <table class="details">
        <tbody>
          <tr>
            <td class="label">Order No:</td>
            <td class="value">${escapeHtml(getOrderNumber(order))}</td>
            <td class="label">Order Date:</td>
            <td class="value">${escapeHtml(formatDate(order?.createdAt))}</td>
          </tr>
          <tr>
            <td class="label">Name:</td>
            <td class="value">${escapeHtml(customerName)}</td>
            <td class="label">Paid By:</td>
            <td class="value">${escapeHtml(order?.paymentMethod || "Cash on Delivery")}</td>
          </tr>
          <tr>
            <td class="label">Email:</td>
            <td class="value">${escapeHtml(customerEmail)}</td>
            <td class="label">Phone:</td>
            <td class="value">${escapeHtml(customerPhone)}</td>
          </tr>
          <tr>
            <td class="label">Delivery Address:</td>
            <td class="value" colspan="3">${escapeHtml(formatAddress(order?.shippingAddress))}</td>
          </tr>
        </tbody>
      </table>

      <h2>Order Items:</h2>
        <table>
        <thead class="items">
          <tr>
            <th style="width: 4%;">#</th>
            <th style="width: 30%;">Product Name</th>
            <th style="width: 18%;">SKU</th>
            <th style="width: 10%;">Varient</th>
            <th style="width: 9%;">Price</th>
            <th style="width: 7%;">QTY</th>
            <th style="width: 12%;">Item Total</th>
            <th style="width: 10%;">Paid<br />Price</th>
          </tr>
        </thead>
        <tbody class="items">
          ${rows || '<tr class="empty-row"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'}
        </tbody>
        </table>

      <div class="totals-wrap">
        <table class="totals">
          <tbody>
            <tr>
              <td class="total-label">Sub Total:</td>
              <td class="amount">${formatMoney(subtotal)}</td>
            </tr>
            <tr>
              <td>Shipping Cost:</td>
              <td class="amount">${formatMoney(shippingFee)}</td>
            </tr>
            <tr>
              <td>Discount:</td>
              <td class="amount">${formatMoney(discount)}</td>
            </tr>
            <tr>
              <td>Advance</td>
              <td class="amount">${formatMoney(advance)}</td>
            </tr>
            <tr class="cod">
              <td>Cash On Delivery</td>
              <td class="amount">${formatMoney(codAmount)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="footer-note">
        Please check the product quantity, model, and type during delivery. Do not open the main seal/package before receiving.
        Unboxing video is required for any missing, wrong, or damaged product claim. After delivery, all issues will be handled as per CartOut policy.
      </p>
    </main>
  </body>
</html>`;
};

const buildInvoicePdf = async (order, options = {}) => {
  const browser = await puppeteer.launch(await getInvoiceBrowserLaunchOptions());

  try {
    const page = await browser.newPage();
    await page.setContent(buildInvoiceHtml(order, options), {
      waitUntil: "networkidle0",
    });
    await page.emulateMediaType("screen");

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "0mm",
        right: "0mm",
        bottom: "0mm",
        left: "0mm",
      },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
};

module.exports = {
  buildInvoiceEmailHtml,
  buildInvoiceHtml,
  buildInvoicePdf,
};
