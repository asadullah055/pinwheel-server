const express = require("express");
const createError = require("http-errors");

const cookieParser = require("cookie-parser");
const cors = require("cors");
const connectDB = require("./src/config/db");
const { errorMessage } = require("./src/utils/response");
const authRoutes = require('./src/routes/authRoutes')
const brandRoutes = require('./src/routes/brandRoutes')
const categoryRoutes = require('./src/routes/categoryRoutes')
const app = express();

/* const rateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 50,
    message: "Too many request from this API",
  }); */
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    return callback(null, true);
  },
  credentials: true,
  optionsSuccessStatus: 200,
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
