const express = require("express");
const createError = require("http-errors");

const cookieParser = require("cookie-parser");
const cors = require("cors");
const connectDB = require("./src/config/db");
const { errorMessage } = require("./src/utils/response");
const authRoutes = require('./src/routes/authRoutes')
const brandRoutes = require('./src/routes/brandRoutes')
const categoryRoutes = require('./src/routes/categoryRoutes')
const productRoutes = require('./src/routes/productRoutes')
const app = express();

/* const rateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 50,
    message: "Too many request from this API",
  }); */
  const allowedOrigins = [
    "https://pinwheel-dash.vercel.app",
    "http://localhost:5173", // your local frontend
  ];
  
  const corsOptions = {
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  };
  
app.use(cors(corsOptions));
// app.use(rateLimiter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.get("/", (req, res) => {
  res.status(200).send("Api is working fine");
});




// Routes
app.use('/api/auth', authRoutes)
app.use('/api/brand', brandRoutes)
app.use('/api/category', categoryRoutes)
app.use('/api/product', productRoutes)
connectDB();
app.use((req, res, next) => {
  next(createError(404, "router not found"));
});

app.use((err, req, res, next) => {
  return errorMessage(res, {
    statusCode: err.status,
    message: err.message,
  });
});
module.exports = app;
