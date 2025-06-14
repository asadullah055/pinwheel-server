const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
dotenv.config();
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USERNAME,
    pass: process.env.SMTP_PASSWORD,
  },
});

const sendEmail = async (emailData) => {
  try {
    const mailOptions = {
      from: process.env.SMTP_USERNAME,
      to: emailData.email, 
      subject: emailData.subject,
      html: emailData.html, 
    };

    await transporter.sendMail(mailOptions)
  } catch (error) {
    console.log("something is wrong", error);
    throw error;
  }
};

module.exports = { sendEmail };