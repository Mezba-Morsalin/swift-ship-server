const dns = require("node:dns");

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
} = require("mongodb");

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;
const PORT = process.env.PORT || 5000;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// ==========================================
// RUN SERVER
// ==========================================

async function run() {
  try {
    await client.connect();

    const db = client.db(process.env.AUTH_DB_COLLECTION);

    const shipmentCollection = db.collection("shipments");
    const hubsCollection = db.collection("hubs");

    console.log("MongoDB Connected Successfully");

    app.get("/", (req, res) => {
      res.send("Swift Server Running Successfully");
    });

    app.post("/api/shipments", async (req, res) => {
  try {
    const { recipientName, recipientPhone, destination, category, address, instructions, codAmount, weight, status, deliveryCharge,} = req.body;

    // Find hub based on destination
    const hub = await hubsCollection.findOne({
      coverageZones: destination,
    });

    if (!hub) {
      return res.status(400).json({
        success: false,
        message: "No hub found for this destination",
      });
    }

    const shipmentStatus = status || "pending";

    const shipmentData = { recipientName, recipientPhone, destination, category, address, instructions: instructions || "", codAmount: Number(codAmount) || 0, weight: Number(weight) || 0, deliveryCharge: Number(deliveryCharge) || 0, status: shipmentStatus, hubId: hub._id, hubCode: hub.hubCode, hubName: hub.hubName, createdAt: new Date(),
    };

    // Create shipment
    const result = await shipmentCollection.insertOne(shipmentData);

    // Update hub shipment stats
    await hubsCollection.updateOne(
      { _id: hub._id },
      {
        $inc: {
          "shipmentStats.total": 1,
          "shipmentStats.pending": shipmentStatus === "pending" ? 1 : 0,
          "shipmentStats.atHub": shipmentStatus === "atHub" ? 1 : 0,
          "shipmentStats.readyRider":
            shipmentStatus === "readyRider" ? 1 : 0,
          "shipmentStats.outForDelivery":
            shipmentStatus === "outForDelivery" ? 1 : 0,
          "shipmentStats.delivered":
            shipmentStatus === "delivered" ? 1 : 0,
        },
      }
    );

    res.status(201).json({
      success: true,
      message: "Shipment created successfully",
      shipment: {
        ...shipmentData,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Failed to create shipment:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create shipment",
    });
  }
});
    app.get("/api/shipments", async (req, res) => {
      try {
        const { status } = req.query;

        const query = status ? { status } : {};

        const result = await shipmentCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).json({
          success: true,
          data: result,
        });
      } catch (error) {
        console.error("Failed to fetch shipments:", error);

        res.status(500).json({
          success: false,
          message: "Failed to fetch shipments",
        });
      }
    });

    app.get("/api/hubs", async (req, res) => {
  try {
    const hubs = await hubsCollection.find().toArray();

    res.status(200).json(hubs);
  } catch (error) {
    console.error("Failed to fetch hubs:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch hubs",
    });
  }
});

app.get("/api/hubs/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const hub = await hubsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!hub) {
      return res.status(404).json({
        success: false,
        message: "Hub not found",
      });
    }

    res.status(200).json(hub);
  } catch (error) {
    console.error("Failed to fetch hub:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch hub",
    });
  }
});

  } catch (error) {
    console.error("MongoDB connection failed:", error);
  }
}

run();

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});