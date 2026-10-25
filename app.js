const express = require("express");
const createError = require("http-errors");
const compression = require('compression');
const cookieParser = require("cookie-parser");
const cors = require("cors");
const connectDB = require("./src/config/db");
const authRoutes = require('./src/routes/authRoutes')
const brandRoutes = require('./src/routes/brandRoutes')
const categoryRoutes = require('./src/routes/categoryRoutes')
const productRoutes = require('./src/routes/productRoutes')
const bannerRoutes = require('./src/routes/bannerRoutes')
const orderRoutes = require('./src/routes/orderRoutes')
const cartRoutes = require('./src/routes/cartRoutes')
const dashboardRoutes = require('./src/routes/dashboardRoutes')
const helmet = require("helmet");
const { rejectUnsafeInput } = require("./src/middleware/inputValidation");
const { createRequestLimiter } = require("./src/middleware/requestLimits");
const app = express();
app.disable("x-powered-by");
app.set("query parser", "simple");
// Vercel supplies and overwrites its forwarding headers. Do not trust arbitrary
// forwarding headers when the app is hosted directly.
if (process.env.VERCEL) app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1"]);

const allowedOrigins = [
  "https://pinwheel-dash.vercel.app",
  "https://cartout.vercel.app",
  "https://www.cartout.com.bd",
  "https://cartout.com.bd",
  "http://localhost:5173",
  "http://localhost:3000",
  ...(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: "128kb", strict: true }));
app.use(cookieParser());
// CORS alone does not prevent a browser from submitting a state-changing request.
app.use((req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      ((req.headers.origin && !allowedOrigins.includes(req.headers.origin)) ||
       (!req.headers.origin && req.headers["sec-fetch-site"] === "cross-site"))) {
    return next(createError(403, "Request origin is not allowed"));
  }
  next();
});
app.use(compression()); // Compress all routes
app.use("/api", rejectUnsafeInput, createRequestLimiter());
app.get("/", (req, res) => {
  res.status(200).send("Api is working fine");
});


// Routes
app.use('/api/auth', authRoutes)
app.use('/api/brand', brandRoutes)
app.use('/api/category', categoryRoutes)
app.use('/api/product', productRoutes)
app.use('/api/banner', bannerRoutes)
app.use('/api/order', orderRoutes)
app.use('/api/cart', cartRoutes)
app.use('/api/dashboard', dashboardRoutes)
connectDB();
app.use((req, res, next) => {
  next(createError(404, "router not found"));
});

app.use((err, req, res, next) => {
  let status = err.status || err.statusCode || 500;
  if (["CastError", "ValidationError", "StrictModeError"].includes(err.name)) status = 400;
  if (err.code === 11000) status = 409;
  if (err.type === "entity.too.large") status = 413;
  if (err.type === "entity.parse.failed") status = 400;
  if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
  const message = status >= 500 ? "Unable to complete this request" :
    err.type === "entity.parse.failed" ? "Invalid JSON input" :
    err.type === "entity.too.large" ? "Request body is too large" :
    err.code === 11000 ? "A record with this value already exists" :
    ["CastError", "ValidationError", "StrictModeError"].includes(err.name) ? "Invalid input" : err.message;
  return res.status(status).json({ success: false, message, ...(status === 400 && err.details ? { errors: err.details } : {}) });
});
module.exports = app;


