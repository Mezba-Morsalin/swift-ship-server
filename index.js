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

// ==========================================
// MONGODB CONNECTION
// ==========================================

async function connectToMongoDB() {
  try {
    await client.connect();

    console.log("You successfully connected to MongoDB!");
  } catch (error) {
    console.error("MongoDB connection failed:", error);
  }
}

// ==========================================
// DISCONNECT MONGODB
// ==========================================

async function disconnectFromMongoDB() {
  try {
    await client.close();

    console.log("MongoDB connection closed");
  } catch (error) {
    console.error("MongoDB disconnect error:", error);
  }
}

// ==========================================
// ROOT ROUTE
// ==========================================

app.get("/", (req, res) => {
  res.send("Swift Server Running Successfully");
});

// ==========================================
// CREATE SHIPMENT
// ==========================================

app.post("/api/shipments", async (req, res) => {
  try {
    const shipmentData = {
      ...req.body,
      status: req.body.status || "PENDING",
      createdAt: new Date(),
    };

    const result = await client
      .db(process.env.AUTH_DB_COLLECTION)
      .collection("shipments")
      .insertOne(shipmentData);

    res.status(201).json({
      success: true,
      message: "Shipment created successfully",
      data: {
        ...shipmentData,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Create shipment error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create shipment",
    });
  }
});

// ==========================================
// GET ALL SHIPMENTS
// ==========================================

app.get("/api/shipments", async (req, res) => {
  try {
    const shipments = await client
      .db(process.env.AUTH_DB_COLLECTION)
      .collection("shipments")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      data: shipments,
    });
  } catch (error) {
    console.error("Failed to fetch shipments:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch shipments",
    });
  }
});

// ==========================================
// SERVER
// ==========================================

app.listen(port, () => {
  console.log(`Swift Server running on port ${port}`);
});

// ==========================================
// START MONGODB CONNECTION
// ==========================================

connectToMongoDB();

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================

process.on("SIGINT", async () => {
  await disconnectFromMongoDB();

  process.exit(0);
});

process.on("SIGTERM", async () => {
  await disconnectFromMongoDB();

  process.exit(0);
});