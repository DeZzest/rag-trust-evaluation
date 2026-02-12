import app from "./server/app";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
