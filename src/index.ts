import app from "./server/app";
import dotenv from "dotenv";

dotenv.config();
console.log("Index file loaded");

const PORT = parseInt(process.env.PORT ?? "4000", 10);

app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
