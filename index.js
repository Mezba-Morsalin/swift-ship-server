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
    const ridersCollection = db.collection("riders");

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


// ==========================================
// UPDATE SHIPMENT STATUS
// ==========================================

app.patch("/api/shipments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // ==========================================
    // Validate Status
    // ==========================================
    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required.",
      });
    }

    if (!["accepted", "cancelled"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shipment action.",
      });
    }

    // ==========================================
    // Validate ObjectId
    // ==========================================
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shipment ID.",
      });
    }

    // ==========================================
    // Find Shipment
    // ==========================================
    const shipment = await shipmentCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!shipment) {
      return res.status(404).json({
        success: false,
        message: "Shipment not found.",
      });
    }

    // ==========================================
    // Only Pending Shipment Can Be Actioned
    // ==========================================
    if (shipment.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Only pending shipments can be actioned.",
      });
    }

    // ==========================================
    // Add Action Without Changing Status
    // ==========================================
    const result = await shipmentCollection.updateOne(
      {
        _id: new ObjectId(id),
      },
      {
        $set: {
          action: {
            type: status,
            createdAt: new Date(),
          },
          updatedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({
        success: false,
        message: "Shipment action was not added.",
      });
    }

    // ==========================================
    // Update Hub Shipment Stats
    // ==========================================
    const hubStatsUpdate = {};

    if (status === "accepted") {
      hubStatsUpdate["shipmentStats.pending"] = -1;
      hubStatsUpdate["shipmentStats.atHub"] = 1;
    }

    if (status === "cancelled") {
      hubStatsUpdate["shipmentStats.pending"] = -1;
    }

    if (
      shipment.hubId &&
      Object.keys(hubStatsUpdate).length > 0
    ) {
      await hubsCollection.updateOne(
        {
          _id: shipment.hubId,
        },
        {
          $inc: hubStatsUpdate,
        }
      );
    }

    // ==========================================
    // Get Updated Shipment
    // ==========================================
    const updatedShipment = await shipmentCollection.findOne({
      _id: new ObjectId(id),
    });

    // ==========================================
    // Success Response
    // ==========================================
    res.status(200).json({
      success: true,
      message: `Shipment ${status} successfully.`,
      shipment: updatedShipment,
    });
  } catch (error) {
    console.error("Shipment action error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update shipment action.",
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

app.post("/api/hubs", async (req, res) => {
  try {
    const { hubCode, hubName, type, division, district, area, address, manager, maxStorage, operationalStatus, coverageZones,} = req.body;

    // Required field validation
    if (
      !hubCode ||
      !hubName ||
      !type ||
      !division ||
      !district ||
      !area ||
      !address ||
      !manager?.name ||
      !manager?.designation ||
      !manager?.phone ||
      !manager?.email ||
      maxStorage === undefined ||
      !operationalStatus ||
      !Array.isArray(coverageZones)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required hub information.",
      });
    }

    // Check duplicate hub code
    const existingHub = await hubsCollection.findOne({
      hubCode: hubCode.trim().toUpperCase(),
    });

    if (existingHub) {
      return res.status(409).json({
        success: false,
        message: "A hub with this hub code already exists.",
      });
    }

    const hubData = {
      hubCode: hubCode.trim().toUpperCase(),
      hubName: hubName.trim(),
      type: type.trim(),
      division: division.trim(),
      district: district.trim(),
      area: area.trim(),
      address: address.trim(),

      manager: {
        name: manager.name.trim(),
        designation: manager.designation.trim(),
        phone: manager.phone.trim(),
        email: manager.email.trim().toLowerCase(),
      },

      maxStorage: Number(maxStorage),

      operationalStatus: operationalStatus.trim(),

      coverageZones: coverageZones
        .map((zone) => zone.trim())
        .filter(Boolean),

      assignedRiders: [],

      shipmentStats: {
        total: 0,
        pending: 0,
        atHub: 0,
        readyRider: 0,
        outForDelivery: 0,
        delivered: 0,
      },

      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await hubsCollection.insertOne(hubData);

    res.status(201).json({
      success: true,
      message: "Hub created successfully.",
      insertedId: result.insertedId,
      hub: {
        ...hubData,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Create hub error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create hub.",
      error: error.message,
    });
  }
});

// ==========================================
// CREATE RIDER
// ==========================================
app.post("/api/riders", async (req, res) => {
  try {
    const { name, email, phone, nid, division, district, area, address, hubCode, riderType, vehicleType, joiningDate, image,} = req.body;

    // ==========================================
    // Required Field Validation
    // ==========================================
    if (
      !name ||
      !email ||
      !phone ||
      !nid ||
      !division ||
      !district ||
      !area ||
      !address ||
      !hubCode ||
      !riderType ||
      !vehicleType ||
      !joiningDate
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required rider information.",
      });
    }

    // ==========================================
    // Check Duplicate Email
    // ==========================================
    const existingEmail = await ridersCollection.findOne({
      email: email.trim().toLowerCase(),
    });

    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: "A rider with this email already exists.",
      });
    }

    // ==========================================
    // Check Duplicate Phone
    // ==========================================
    const existingPhone = await ridersCollection.findOne({
      phone: phone.trim(),
    });

    if (existingPhone) {
      return res.status(409).json({
        success: false,
        message: "A rider with this phone number already exists.",
      });
    }

    // ==========================================
    // Find Hub By Hub Code
    // ==========================================
    const hub = await hubsCollection.findOne({
      hubCode: hubCode.trim().toUpperCase(),
    });

    if (!hub) {
      return res.status(404).json({
        success: false,
        message: "Selected hub not found.",
      });
    }

    // ==========================================
    // Check Hub Status
    // ==========================================
    if (hub.operationalStatus !== "active") {
      return res.status(400).json({
        success: false,
        message: "Selected hub is not active.",
      });
    }

    // ==========================================
    // Rider Data
    // ==========================================
    const riderData = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      nid: nid.trim(),

      division: division.trim(),
      district: district.trim(),
      area: area.trim(),
      address: address.trim(),

      hubCode: hub.hubCode,

      riderType: riderType.trim(),
      vehicleType: vehicleType.trim(),
      joiningDate,

      image: image || "",

      // New rider always starts as pending
      status: "pending",

      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // ==========================================
    // Insert Rider
    // ==========================================
    const riderResult = await ridersCollection.insertOne(riderData);

// ==========================================
// Add Rider Info To Hub
// ==========================================

await hubsCollection.updateOne(
  {
    _id: hub._id,
  },
  {
    $addToSet: {
      assignedRiders: {
        riderId: riderResult.insertedId,
        name: riderData.name,
        email: riderData.email,
        phone: riderData.phone,
      },
    },
  }
);

    // ==========================================
    // Success Response
    // ==========================================
    res.status(201).json({
      success: true,
      message: "Rider created and assigned to hub successfully.",
      rider: {
        ...riderData,
        _id: riderResult.insertedId,
      },
    });
  } catch (error) {
    console.error("Create rider error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create rider.",
      error: error.message,
    });
  }
});

// ==========================================
// GET ALL RIDERS
// ==========================================
app.get("/api/riders", async (req, res) => {
  try {
    const { status, hubCode } = req.query;

    const query = {};

    // Filter by status
    if (status) {
      query.status = status;
    }

    // Filter by hub code
    if (hubCode) {
      query.hubCode = hubCode.trim().toUpperCase();
    }

    const riders = await ridersCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      count: riders.length,
      data: riders,
    });
  } catch (error) {
    console.error("Failed to fetch riders:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch riders.",
    });
  }
});

app.patch("/api/riders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, userId } = req.body;

    if (!status && !userId) {
      return res.status(400).json({
        success: false,
        message: "Nothing to update.",
      });
    }

    if (status && !["pending", "active", "suspended"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid rider status.",
      });
    }

    const updateData = {
      updatedAt: new Date(),
    };

    if (status) {
      updateData.status = status;
    }

    if (userId) {
      updateData.userId = userId;
    }

    const result = await ridersCollection.updateOne(
      {
        _id: new ObjectId(id),
      },
      {
        $set: updateData,
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Rider not found.",
      });
    }

    const updatedRider = await ridersCollection.findOne({
      _id: new ObjectId(id),
    });

    res.status(200).json({
      success: true,
      message: "Rider updated successfully.",
      rider: updatedRider,
    });
  } catch (error) {
    console.error("Update rider error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update rider.",
      error: error.message,
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