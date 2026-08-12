const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient } = require("mongodb");

dotenv.config();

const app = express();

const port = process.env.PORT || 5000;

const client = new MongoClient(process.env.MONGO_URI);

app.use(cors());
app.use(express.json());

async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
  } catch (err) {
    console.error("MongoDB connection failed:", err);
  }
}

async function disconnectFromMongoDB() {
  await client.close();
}

app.get("/", (req, res) => {
  res.send("Swift Server Running Successfully");
});

app.listen(port, () => {
  console.log(`Swift Server running on port ${port}`);
});

connectToMongoDB();