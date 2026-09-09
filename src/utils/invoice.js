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
      timeout: Number(process.env.INVOICE_BROWSER_TIMEOUT_MS || 15000),
    };
  }

  if (isServerlessRuntime()) {
    return {
      args: puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: "shell",
      timeout: Number(process.env.INVOICE_BROWSER_TIMEOUT_MS || 15000),
    };
  }

  return {
    channel: "chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    timeout: Number(process.env.INVOICE_BROWSER_TIMEOUT_MS || 15000),
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

const iconSvg = (name) => {
  const attrs =
    'class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const icons = {
    cart: `<svg ${attrs}><circle cx="9" cy="21" r="1.5"/><circle cx="19" cy="21" r="1.5"/><path d="M2.5 3h3l2.4 12.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 1.9-1.4L22 7H7"/></svg>`,
    clipboard: `<svg ${attrs}><path d="M9 4h6"/><path d="M9 2h6v4H9z"/><path d="M7 4H5.8A1.8 1.8 0 0 0 4 5.8v14.4A1.8 1.8 0 0 0 5.8 22h12.4a1.8 1.8 0 0 0 1.8-1.8V5.8A1.8 1.8 0 0 0 18.2 4H17"/><path d="M8 11h8"/><path d="M8 16h5"/></svg>`,
    facebook: `<svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 8h2V5h-2.4C10.8 5 9 6.8 9 9.6V12H7v3h2v6h3v-6h2.4l.6-3h-3V9.8c0-1.1.4-1.8 2-1.8z"/></svg>`,
    fileText: `<svg ${attrs}><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>`,
    globe: `<svg ${attrs}><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></svg>`,
    image: `<svg ${attrs}><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-5-5L5 19"/></svg>`,
    mail: `<svg ${attrs}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>`,
    phone: `<svg ${attrs}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7A2 2 0 0 1 22 16.9z"/></svg>`,
    user: `<svg ${attrs}><circle cx="12" cy="8" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/></svg>`,
  };

  return icons[name] || "";
};

const getOrderNumber = (order) =>
  order?.orderNumber ? `#${order.orderNumber}` : `#${String(order?._id || "").slice(-8)}`;

const getProductName = (item) => item?.product?.productName || item?.name || "Product";

const getInvoiceSku = (item) => item?.product?.sku || item?.sku || "N/A";

const getSellerName = (item) =>
  item?.seller?.shopName ||
  item?.seller?.name ||
  item?.product?.creator?.shopName ||
  item?.product?.creator?.name ||
  "Cartout Seller";

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
  const regularPrice = getRegularUnitPrice(item);

  if (
    Number.isFinite(discountPrice) &&
    discountPrice > 0 &&
    discountPrice < regularPrice
  ) {
    if (!variant?.discountStartDate && !variant?.discountEndDate) {
      return discountPrice;
    }

    const now = new Date();
    const startDate = variant.discountStartDate
      ? new Date(variant.discountStartDate)
      : null;
    const endDate = variant.discountEndDate ? new Date(variant.discountEndDate) : null;

    if (
      (!startDate || now >= startDate) &&
      (!endDate || now <= endDate) &&
      (!startDate || !Number.isNaN(startDate.getTime())) &&
      (!endDate || !Number.isNaN(endDate.getTime()))
    ) {
      return discountPrice;
    }
  }

  return regularPrice;
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

const getInvoiceLogoUrl = () =>
  process.env.INVOICE_LOGO_URL ||
  process.env.CARTOUT_LOGO_URL ||
  "https://www.cartout.com.bd/images/mainlogo.png";

const getLogoDataUri = () => {
  if (cachedLogoDataUri !== null) return cachedLogoDataUri;

  const logoPaths = [
    process.env.INVOICE_LOGO_PATH,
    path.resolve(__dirname, "../assets/mainlogo.png"),
    path.resolve(__dirname, "../../../cartout/public/images/mainlogo.png"),
    path.resolve(__dirname, "../assets/darklogo.png"),
    path.resolve(__dirname, "../../../cartout/public/images/darklogo.png"),
    path.resolve(__dirname, "../../../public/images/mainlogo.png"),
    path.resolve(__dirname, "../../../public/images/darklogo.png"),
    path.resolve(__dirname, "../../../dashboard/public/image/mainlogo.png"),
    path.resolve(__dirname, "../../../cartout/public/images/cartout2.png"),
    path.resolve(__dirname, "../../../dashboard/public/image/logo.png"),
    path.resolve(__dirname, "../../../client/public/images/mainlogo.png"),
  ].filter(Boolean);

  for (const logoPath of logoPaths) {
    try {
      if (fs.existsSync(logoPath)) {
        cachedLogoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
        return cachedLogoDataUri;
      }
    } catch (error) {
      cachedLogoDataUri = "";
      return cachedLogoDataUri;
    }
  }

  cachedLogoDataUri = "";
  return cachedLogoDataUri;
};

const waitForInvoiceAssets = async (page) => {
  const timeoutMs = Number(process.env.INVOICE_ASSET_WAIT_MS || 1200);

  await page.evaluate(async (timeout) => {
    const imagePromises = Array.from(document.images).map((image) => {
      if (image.complete) return undefined;
      if (typeof image.decode === "function") {
        return image.decode().catch(() => undefined);
      }

      return new Promise((resolve) => {
        image.onload = resolve;
        image.onerror = resolve;
      });
    });

    await Promise.race([
      Promise.all(imagePromises),
      new Promise((resolve) => setTimeout(resolve, timeout)),
    ]);

    if (document.fonts?.ready) {
      await Promise.race([
        document.fonts.ready.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, timeout)),
      ]);
    }
  }, timeoutMs);
};

const getSellerLogoSrc = (order) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const sellerLogo =
    order?.sellerLogo ||
    items.find((item) => item?.seller?.shopLogo)?.seller?.shopLogo ||
    items.find((item) => item?.product?.creator?.shopLogo)?.product?.creator?.shopLogo;

  if (!sellerLogo) return "";

  return String(sellerLogo);
};

const getFooterContact = () => ({
  email: process.env.CARTOUT_SUPPORT_EMAIL || "your@email.com",
  phone: process.env.CARTOUT_SUPPORT_PHONE || "+880 1XXX-XXXXXX",
  website: process.env.CARTOUT_WEBSITE || "www.cartout.com.bd",
  facebook:
    process.env.CARTOUT_FACEBOOK || "www.facebook.com/cartoutofficial",
});

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
  const sellerLogoSrc = getSellerLogoSrc(order);
  const footerContact = getFooterContact();
  const logoMarkup = logoDataUri
    ? `<img src="${logoDataUri}" alt="CartOut" />`
    : `<img src="${escapeHtml(getInvoiceLogoUrl())}" alt="CartOut" />`;
  const sellerLogoMarkup = sellerLogoSrc
    ? `<img src="${escapeHtml(sellerLogoSrc)}" alt="${escapeHtml(sellerName)} logo" />`
    : `<span class="seller-logo-placeholder">${iconSvg("image")}</span><strong>SELLER LOGO</strong>`;
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
  const blankRows = Array.from({ length: Math.max(0, 4 - items.length) })
    .map(
      () =>
        '<tr class="empty-row"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'
    )
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
        color: #080d27;
        font-family: Arial, Helvetica, sans-serif;
      }
      .invoice-sheet {
        width: 210mm;
        height: 297mm;
        margin: 0 auto;
        padding: 12mm 8.5mm 20mm;
        background: #ffffff;
        position: relative;
        overflow: hidden;
      }
      .top-band,
      .bottom-band {
        position: absolute;
        left: 0;
        right: 0;
        height: 6.2mm;
        background: #ffb000;
      }
      .top-band {
        top: 0;
      }
      .bottom-band {
        bottom: 0;
      }
      .top-band::before,
      .bottom-band::before {
        content: "";
        position: absolute;
        left: 0;
        width: 97mm;
        height: 100%;
        background: #080d27;
      }
      .top-band::after {
        content: "";
        position: absolute;
        left: 96mm;
        top: 0;
        border-left: 5mm solid #ffffff;
        border-top: 6.2mm solid transparent;
      }
      .bottom-band::before {
        left: auto;
        right: 0;
      }
      .bottom-band::after {
        content: "";
        position: absolute;
        right: 96mm;
        top: 0;
        border-right: 5mm solid #ffffff;
        border-bottom: 6.2mm solid transparent;
      }
      .header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8mm;
        min-height: 41mm;
        margin-bottom: 4mm;
      }
      .brand-logo {
        width: 123mm;
        height: 39mm;
        position: relative;
        overflow: hidden;
      }
      .brand-logo img {
        display: block;
        width: 105mm;
        height: auto;
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
      }
      .brand-logo strong {
        display: block;
        font-size: 36px;
        line-height: 1;
        letter-spacing: 0;
      }
      .brand-logo em {
        color: #f8ad00;
        font-style: normal;
      }
      .brand-logo small {
        display: block;
        font-size: 12px;
        line-height: 1;
        margin-left: 53mm;
      }
      .seller-panel {
        flex: 1;
        min-height: 40mm;
        border-left: 1px solid #cfcfcf;
        padding-left: 8mm;
        text-align: center;
      }
      .seller-logo {
        width: 45mm;
        height: 28mm;
        margin: 0 auto 5mm;
        border: 1px dashed #8d8d8d;
        border-radius: 3mm;
        display: grid;
        place-items: center;
        color: #6e6e6e;
        font-size: 13px;
        font-weight: 700;
        overflow: hidden;
      }
      .seller-logo img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .seller-logo-placeholder {
        display: block;
        width: 13mm;
        height: 13mm;
        margin: 0 auto 2mm;
        color: #6e6e6e;
      }
      .seller-name {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 3mm;
        font-size: 15px;
        font-weight: 700;
      }
      .seller-avatar,
      .contact-icon {
        width: 8mm;
        height: 8mm;
        border-radius: 50%;
        background: #080d27;
        color: #ffffff;
        display: inline-grid;
        place-items: center;
        font-size: 13px;
        font-weight: 700;
        flex: 0 0 auto;
      }
      .scope-label {
        display: inline-block;
        margin-left: 2mm;
        color: #f8ad00;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
      }
      .section-title {
        display: flex;
        align-items: center;
        gap: 3mm;
        margin: 3.5mm 0 2.7mm;
        color: #080d27;
        font-size: 17px;
        font-weight: 800;
      }
      .section-title::after {
        content: "";
        height: 1px;
        background: #f8ad00;
        flex: 1;
      }
      .section-icon {
        width: 8mm;
        height: 8mm;
        border-radius: 1mm;
        background: #080d27;
        display: inline-grid;
        place-items: center;
        position: relative;
        flex: 0 0 auto;
        color: #f8ad00;
      }
      .icon-svg {
        display: block;
        width: 62%;
        height: 62%;
        margin: auto;
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
        border: 1px solid #d8d8d8;
      }
      .details td {
        height: 10.2mm;
        padding: 2.1mm 2.4mm;
        font-size: 12.5px;
        line-height: 1.25;
        overflow-wrap: anywhere;
        vertical-align: middle;
      }
      .details .label {
        width: 18.5%;
        font-weight: 700;
        white-space: nowrap;
      }
      .details .value {
        width: 31.5%;
        white-space: normal;
      }
      .items th {
        height: 9.2mm;
        padding: 2mm 1.5mm;
        background: #080d27;
        color: #ffffff;
        font-size: 12.5px;
        line-height: 1.15;
        text-align: center;
        vertical-align: middle;
        font-weight: 700;
      }
      .items td {
        height: 8.1mm;
        padding: 2mm 1.5mm;
        color: #222222;
        font-size: 11.5px;
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
        height: 8.1mm;
      }
      .totals-wrap {
        width: 45%;
        margin-left: auto;
      }
      .totals td {
        height: 8.9mm;
        padding: 2mm 3mm;
        color: #2c2c2c;
        font-size: 12.5px;
        line-height: 1.25;
      }
      .totals .total-label {
        width: 52%;
      }
      .totals .amount {
        width: 48%;
        text-align: right;
      }
      .totals .cod td {
        background: #fff0cf;
        color: #080d27;
        font-weight: 700;
      }
      .notes-box {
        position: absolute;
        left: 8.5mm;
        right: 8.5mm;
        bottom: 36mm;
        min-height: 27mm;
        border: 1px solid #cfcfcf;
        border-radius: 3.5mm;
        padding: 5mm 6mm 4.5mm 16mm;
        color: #252a3a;
        font-size: 11px;
        line-height: 1.45;
      }
      .notes-box h2 {
        margin: 0 0 1.5mm;
        font-size: 14px;
        line-height: 1.2;
      }
      .notes-icon {
        position: absolute;
        left: 5mm;
        top: 5mm;
        width: 9mm;
        height: 9mm;
        border-radius: 50%;
        background: #f8ad00;
        color: #ffffff;
        display: grid;
        place-items: center;
      }
      .footer-note {
        margin: 0;
      }
      .contact-row {
        position: absolute;
        left: 8.5mm;
        right: 8.5mm;
        bottom: 12mm;
        border-top: 1px solid #f8ad00;
        padding-top: 4mm;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0;
        color: #080d27;
      }
      .contact-item {
        min-height: 10mm;
        display: grid;
        grid-template-columns: 8mm 1fr;
        gap: 3mm;
        align-items: center;
        padding: 0 4mm;
        border-right: 1px solid #d0d0d0;
      }
      .contact-item:first-child {
        padding-left: 0;
      }
      .contact-item:last-child {
        border-right: 0;
        padding-right: 0;
      }
      .contact-label {
        display: block;
        font-size: 8.3px;
        font-weight: 700;
        margin-bottom: 0.5mm;
      }
      .contact-value {
        display: block;
        color: #1f2937;
        font-size: 8px;
        line-height: 1.2;
        overflow-wrap: anywhere;
      }
      .content {
        padding-bottom: 70mm;
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
      <div class="top-band" aria-hidden="true"></div>
      <div class="bottom-band" aria-hidden="true"></div>

      <section class="header" aria-label="Invoice header">
        <div class="brand-logo">
          ${logoMarkup}
        </div>
        <div class="seller-panel">
          <div class="seller-logo">
            ${sellerLogoMarkup}
          </div>
          <div class="seller-name"><span class="seller-avatar">${iconSvg("user")}</span>${escapeHtml(sellerName)} ${scopeLabel}</div>
        </div>
      </section>

      <div class="content">
        <div class="section-title"><span class="section-icon">${iconSvg("clipboard")}</span><span>Order Details</span></div>
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

        <div class="section-title"><span class="section-icon">${iconSvg("cart")}</span><span>Order Items</span></div>
        <table>
          <thead class="items">
            <tr>
              <th style="width: 4.8%;">#</th>
              <th style="width: 25.2%;">Product Name</th>
              <th style="width: 11.5%;">SKU</th>
              <th style="width: 13.2%;">Variant</th>
              <th style="width: 11.8%;">Price</th>
              <th style="width: 8.8%;">QTY</th>
              <th style="width: 12.8%;">Item Total</th>
              <th style="width: 11.9%;">Paid Price</th>
            </tr>
          </thead>
          <tbody class="items">
            ${rows}${blankRows}
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
      </div>

      <section class="notes-box">
        <span class="notes-icon">${iconSvg("fileText")}</span>
        <h2>Customer Notes</h2>
        <p class="footer-note">
          Please check the product quantity, model, and type during delivery. Do not open the main seal/package before receiving.
          For any missing, wrong, or damaged product claim, the unboxing video must be recorded in front of the delivery rider
          while opening the package. After delivery, all issues will be handled as per CartOut policy.
        </p>
      </section>

      <section class="contact-row" aria-label="CartOut contact information">
        <div class="contact-item">
          <span class="contact-icon">${iconSvg("mail")}</span>
          <span><strong class="contact-label">CartOut Support Email</strong><span class="contact-value">${escapeHtml(footerContact.email)}</span></span>
        </div>
        <div class="contact-item">
          <span class="contact-icon">${iconSvg("phone")}</span>
          <span><strong class="contact-label">CartOut Phone Number</strong><span class="contact-value">${escapeHtml(footerContact.phone)}</span></span>
        </div>
        <div class="contact-item">
          <span class="contact-icon">${iconSvg("globe")}</span>
          <span><strong class="contact-label">Website</strong><span class="contact-value">${escapeHtml(footerContact.website)}</span></span>
        </div>
        <div class="contact-item">
          <span class="contact-icon">${iconSvg("facebook")}</span>
          <span><strong class="contact-label">Facebook</strong><span class="contact-value">${escapeHtml(footerContact.facebook)}</span></span>
        </div>
      </section>
    </main>
  </body>
</html>`;
};

const buildInvoicePdf = async (order, options = {}) => {
  const browser = await puppeteer.launch(await getInvoiceBrowserLaunchOptions());

  try {
    const page = await browser.newPage();
    await page.setContent(buildInvoiceHtml(order, options), {
      waitUntil: "domcontentloaded",
      timeout: Number(process.env.INVOICE_PAGE_TIMEOUT_MS || 8000),
    });
    await waitForInvoiceAssets(page);
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
