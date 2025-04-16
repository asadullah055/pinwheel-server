const app = require("./app");
const serverProt = process.env.PORT
app.listen(serverProt, async () => {
  console.log("server is running on port " + serverProt);
});
