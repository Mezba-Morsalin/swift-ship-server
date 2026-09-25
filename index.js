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


// RUN SERVER


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



// CREATE SHIPMENT


app.post("/api/shipments", async (req, res) => {
  try {
    const {
      recipientName,
      recipientPhone,
      destination,
      category,
      address,
      instructions,
      codAmount,
      weight,
      status,
      deliveryCharge,
    } = req.body;

    // 
    // Find Hub Based On Destination
    // 

    const hub = await hubsCollection.findOne({
      coverageZones: destination,
    });

    if (!hub) {
      return res.status(400).json({
        success: false,
        message: "No hub found for this destination",
      });
    }

    // 
    // Default Shipment Status
    // 

    const shipmentStatus = status || "pending";

    // 
    // Shipment Data
    // 

    const shipmentData = {
      recipientName,
      recipientPhone,
      destination,
      category,
      address,
      instructions: instructions || "",

      codAmount: Number(codAmount) || 0,
      weight: Number(weight) || 0,
      deliveryCharge: Number(deliveryCharge) || 0,

      // Actual shipment status
      status: shipmentStatus,

      // Hub information
      hubId: hub._id,
      hubCode: hub.hubCode,
      hubName: hub.hubName,

      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 
    // Create Shipment
    // 

    const result = await shipmentCollection.insertOne(shipmentData);



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


// 
// GET ALL SHIPMENTS
// 

app.get("/api/shipments", async (req, res) => {
  try {
    const { status } = req.query;

    const query = status
      ? { status }
      : {};

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

app.get("/api/shipments/rider/:riderId", async (req, res) => {
  try {
    const { riderId } = req.params;

    if (!ObjectId.isValid(riderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid rider ID.",
      });
    }

    const shipments = await shipmentCollection
      .find({
        riderId: new ObjectId(riderId),
        "action.type": "accepted",
        assignmentStatus: {
          $in: ["requested", "accepted"],
        },
      })
      .sort({ assignedAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      count: shipments.length,
      data: shipments,
    });
  } catch (error) {
    console.error(
      "Failed to fetch rider shipments:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Failed to fetch rider shipments.",
    });
  }
});

app.patch("/api/shipments/:id/rider-action",
  async (req, res) => {
    try {
      const { id } = req.params;
      const { action } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid shipment ID.",
        });
      }

      if (!["accepted", "rejected", "delivered"].includes(action)) {
        return res.status(400).json({
          success: false,
          message: "Invalid rider action.",
        });
      }

      const shipment = await shipmentCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!shipment) {
        return res.status(404).json({
          success: false,
          message: "Shipment not found.",
        });
      }

      // 
      // ACCEPT SHIPMENT
      // 

      if (action === "accepted") {
        if (shipment.assignmentStatus !== "requested") {
          return res.status(400).json({
            success: false,
            message:
              "This shipment is not waiting for rider acceptance.",
          });
        }

        const result =
          await shipmentCollection.updateOne(
            {
              _id: new ObjectId(id),
              assignmentStatus: "requested",
            },
            {
              $set: {
                assignmentStatus: "accepted",
                status: "in_transit",
                updatedAt: new Date(),
              },
            }
          );

        if (result.modifiedCount === 0) {
          return res.status(400).json({
            success: false,
            message:
              "Shipment could not be accepted.",
          });
        }
      }

      // 
      // REJECT SHIPMENT
      // 

      if (action === "rejected") {
        if (shipment.assignmentStatus !== "requested") {
          return res.status(400).json({
            success: false,
            message:
              "This shipment cannot be rejected.",
          });
        }

        const result =
          await shipmentCollection.updateOne(
            {
              _id: new ObjectId(id),
              assignmentStatus: "requested",
            },
            {
              $set: {
                assignmentStatus: "rejected",
                riderId: null,
                riderName: null,
                assignedAt: null,
                updatedAt: new Date(),
              },
            }
          );

        if (result.modifiedCount === 0) {
          return res.status(400).json({
            success: false,
            message:
              "Shipment could not be rejected.",
          });
        }
      }

      // 
      // DELIVER SHIPMENT
      // 

      if (action === "delivered") {
        if (
          shipment.assignmentStatus !== "accepted" &&
          shipment.status !== "in_transit"
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Only in-transit shipments can be delivered.",
          });
        }

        const result =
          await shipmentCollection.updateOne(
            {
              _id: new ObjectId(id),
            },
            {
              $set: {
                status: "delivered",
                assignmentStatus: "completed",
                deliveredAt: new Date(),
                updatedAt: new Date(),
              },
            }
          );

        if (result.modifiedCount === 0) {
          return res.status(400).json({
            success: false,
            message:
              "Shipment could not be marked as delivered.",
          });
        }
      }

      const updatedShipment =
        await shipmentCollection.findOne({
          _id: new ObjectId(id),
        });

      return res.status(200).json({
        success: true,
        message:
          action === "accepted"
            ? "Shipment accepted successfully."
            : action === "rejected"
            ? "Shipment request rejected."
            : "Shipment marked as delivered.",
        shipment: updatedShipment,
      });
    } catch (error) {
      console.error(
        "Rider shipment action error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to update shipment.",
      });
    }
  }
);

// ADMIN SHIPMENT ACTION
// ACCEPT / CANCEL

app.patch("/api/shipments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // 
    // Validate Action
    // 

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Action is required.",
      });
    }

    if (!["accepted", "cancelled"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shipment action.",
      });
    }

    // 
    // Validate ObjectId
    // 

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shipment ID.",
      });
    }

    // 
    // Find Shipment
    // 

    const shipment = await shipmentCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!shipment) {
      return res.status(404).json({
        success: false,
        message: "Shipment not found.",
      });
    }

    // 
    // Shipment Must Be Pending
    // 

    if (shipment.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Only pending shipments can be actioned.",
      });
    }

    // 
    // Prevent Duplicate Action
    // 

    if (shipment.action?.type) {
      return res.status(400).json({
        success: false,
        message: `Shipment has already been ${shipment.action.type}.`,
      });
    }

    //
    // Add Admin Action
    // IMPORTANT:
    // Root shipment status remains "pending"
    // 

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

    // Get Updated Shipment

    const updatedShipment = await shipmentCollection.findOne({
      _id: new ObjectId(id),
    });

    // Success Response

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


// GET ALL HUBS
// WITH DYNAMIC SHIPMENT STATS

app.get("/api/hubs", async (req, res) => {
  try {
    const hubs = await hubsCollection.find().toArray();

    // ==========================================
    // Calculate Stats From Shipments Collection
    // ==========================================

    const hubsWithStats = await Promise.all(
      hubs.map(async (hub) => {
        const shipmentStats = await shipmentCollection
          .aggregate([
            {
              $match: {
                hubId: hub._id,

                // Cancelled shipments do not belong
                // to Hub shipment flow
                "action.type": {
                  $ne: "cancelled",
                },
              },
            },

            {
              $group: {
                _id: null,

                total: {
                  $sum: 1,
                },

                pending: {
                  $sum: {
                    $cond: [
                      {
                        $eq: ["$status", "pending"],
                      },
                      1,
                      0,
                    ],
                  },
                },

                atHub: {
                  $sum: {
                    $cond: [
                      {
                        $eq: ["$status", "atHub"],
                      },
                      1,
                      0,
                    ],
                  },
                },

                readyRider: {
                  $sum: {
                    $cond: [
                      {
                        $eq: ["$status", "readyRider"],
                      },
                      1,
                      0,
                    ],
                  },
                },

                outForDelivery: {
                  $sum: {
                    $cond: [
                      {
                        $eq: ["$status", "outForDelivery"],
                      },
                      1,
                      0,
                    ],
                  },
                },

                delivered: {
                  $sum: {
                    $cond: [
                      {
                        $eq: ["$status", "delivered"],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ])
          .toArray();

        const stats = shipmentStats[0] || {
          total: 0,
          pending: 0,
          atHub: 0,
          readyRider: 0,
          outForDelivery: 0,
          delivered: 0,
        };

        return {
          ...hub,
          shipmentStats: stats,
        };
      })
    );

    res.status(200).json(hubsWithStats);
  } catch (error) {
    console.error("Failed to fetch hubs:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch hubs",
    });
  }
});


// 
// GET SINGLE HUB
// WITH DYNAMIC SHIPMENT STATS
// 

app.get("/api/hubs/:id", async (req, res) => {
  try {
    const { id } = req.params;


    // Validate ObjectId


    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid hub ID",
      });
    }
    // Find Hub


    const hub = await hubsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!hub) {
      return res.status(404).json({
        success: false,
        message: "Hub not found",
      });
    }

    // ==========================================
    // Calculate Shipment Stats
    // ==========================================

    const shipmentStats = await shipmentCollection
      .aggregate([
        {
          $match: {
            hubId: hub._id,

            // Cancelled shipment excluded
            "action.type": {
              $ne: "cancelled",
            },
          },
        },

        {
          $group: {
            _id: null,

            total: {
              $sum: 1,
            },

            pending: {
              $sum: {
                $cond: [
                  {
                    $eq: ["$status", "pending"],
                  },
                  1,
                  0,
                ],
              },
            },

            atHub: {
              $sum: {
                $cond: [
                  {
                    $eq: ["$status", "atHub"],
                  },
                  1,
                  0,
                ],
              },
            },

            readyRider: {
              $sum: {
                $cond: [
                  {
                    $eq: ["$status", "readyRider"],
                  },
                  1,
                  0,
                ],
              },
            },

            outForDelivery: {
              $sum: {
                $cond: [
                  {
                    $eq: ["$status", "outForDelivery"],
                  },
                  1,
                  0,
                ],
              },
            },

            delivered: {
              $sum: {
                $cond: [
                  {
                    $eq: ["$status", "delivered"],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
      .toArray();

    const stats = shipmentStats[0] || {
      total: 0,
      pending: 0,
      atHub: 0,
      readyRider: 0,
      outForDelivery: 0,
      delivered: 0,
    };

    // ==========================================
    // Response
    // ==========================================

    const hubWithStats = {
      ...hub,
      shipmentStats: stats,
    };

    res.status(200).json(hubWithStats);
  } catch (error) {
    console.error("Failed to fetch hub:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch hub",
    });
  }
});



// GET HUB SHIPMENTS
// FOR HUB MANAGE SHIPMENTS PAGE


app.get("/api/hubs/:id/shipments", async (req, res) => {
  try {
    const { id } = req.params;


    // Validate Hub ID


    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid hub ID",
      });
    }

    const hubId = new ObjectId(id);

    // Check Hub


    const hub = await hubsCollection.findOne({
      _id: hubId,
    });

    if (!hub) {
      return res.status(404).json({
        success: false,
        message: "Hub not found",
      });
    }


    // Find Hub Shipments
    //
    // Cancelled shipments are excluded


    const shipments = await shipmentCollection
      .find({
        hubId: hubId,

        "action.type": {
          $ne: "cancelled",
        },
      })
      .sort({
        createdAt: -1,
      })
      .toArray();


    // Response


    res.status(200).json({
      success: true,

      hub: {
        _id: hub._id,
        hubCode: hub.hubCode,
        hubName: hub.hubName,
      },

      data: shipments,
    });
  } catch (error) {
    console.error("Failed to fetch hub shipments:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch hub shipments",
    });
  }
});


// CREATE HUB


app.post("/api/hubs", async (req, res) => {
  try {
    const {
      hubCode,
      hubName,
      type,
      division,
      district,
      area,
      address,
      manager,
      maxStorage,
      operationalStatus,
      coverageZones,
    } = req.body;


    // Required Field Validation


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


    // Check Duplicate Hub Code


    const existingHub = await hubsCollection.findOne({
      hubCode: hubCode.trim().toUpperCase(),
    });

    if (existingHub) {
      return res.status(409).json({
        success: false,
        message: "A hub with this hub code already exists.",
      });
    }


    // Hub Data


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

      // Initial value only.
      // Actual stats are calculated dynamically.
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


    // Insert Hub


    const result = await hubsCollection.insertOne(hubData);


    // Response


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


app.patch("/api/shipments/:id/assign-rider", async (req, res) => {
  try {
    const { id } = req.params;
    const { riderId, riderName } = req.body;

    if (!riderId || !riderName) {
      return res.status(400).json({
        success: false,
        message: "Rider information is required.",
      });
    }

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shipment ID.",
      });
    }

    if (!ObjectId.isValid(riderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid rider ID.",
      });
    }

    const shipment = await shipmentCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!shipment) {
      return res.status(404).json({
        success: false,
        message: "Shipment not found.",
      });
    }

    // Admin must accept the shipment first
    if (shipment.action?.type !== "accepted") {
      return res.status(400).json({
        success: false,
        message: "Only accepted shipments can be assigned to a rider.",
      });
    }

    // Shipment must still be pending
    if (shipment.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "This shipment is no longer available for rider assignment.",
      });
    }

    // Prevent duplicate rider request
    if (shipment.assignmentStatus === "requested") {
      return res.status(400).json({
        success: false,
        message: "A rider request has already been sent for this shipment.",
      });
    }

    // Find rider
    const rider = await ridersCollection.findOne({
      _id: new ObjectId(riderId),
    });

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider not found.",
      });
    }

    // Rider must be active
    if (rider.status?.toLowerCase() !== "active") {
      return res.status(400).json({
        success: false,
        message: "Only active riders can be assigned.",
      });
    }

    // Rider and shipment must belong to same hub
    if (rider.hubCode !== shipment.hubCode) {
      return res.status(400).json({
        success: false,
        message: "Rider does not belong to this shipment's hub.",
      });
    }

    const result = await shipmentCollection.updateOne(
      {
        _id: new ObjectId(id),
      },
      {
        $set: {
          riderId: new ObjectId(riderId),
          riderName: rider.name,
          assignmentStatus: "requested",
          assignedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({
        success: false,
        message: "Rider assignment request was not added.",
      });
    }

    const updatedShipment = await shipmentCollection.findOne({
      _id: new ObjectId(id),
    });

    res.status(200).json({
      success: true,
      message: `Request sent to ${rider.name}.`,
      shipment: updatedShipment,
    });
  } catch (error) {
    console.error("Assign rider error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to assign rider.",
    });
  }
});

app.post("/api/hubs", async (req, res) => {
  try {
    const {
      hubCode,
      hubName,
      type,
      division,
      district,
      area,
      address,
      manager,
      maxStorage,
      operationalStatus,
      coverageZones,
    } = req.body;

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

      // Initial stats only.
      // Actual stats are calculated from shipments collection.
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


// CREATE RIDER

app.post("/api/riders", async (req, res) => {
  try {
    const { name, email, phone, nid, division, district, area, address, hubCode, riderType, vehicleType, joiningDate, image,} = req.body;


    // Required Field Validation

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


    // Check Duplicate Email

    const existingEmail = await ridersCollection.findOne({
      email: email.trim().toLowerCase(),
    });

    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: "A rider with this email already exists.",
      });
    }

    // Check Duplicate Phone

    const existingPhone = await ridersCollection.findOne({
      phone: phone.trim(),
    });

    if (existingPhone) {
      return res.status(409).json({
        success: false,
        message: "A rider with this phone number already exists.",
      });
    }


    // Find Hub By Hub Code

    const hub = await hubsCollection.findOne({
      hubCode: hubCode.trim().toUpperCase(),
    });

    if (!hub) {
      return res.status(404).json({
        success: false,
        message: "Selected hub not found.",
      });
    }


    // Check Hub Status

    if (hub.operationalStatus !== "active") {
      return res.status(400).json({
        success: false,
        message: "Selected hub is not active.",
      });
    }


    // Rider Data

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


    // Insert Rider

    const riderResult = await ridersCollection.insertOne(riderData);


// Add Rider Info To Hub


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


    // Success Response

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

// GET ALL RIDERS

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