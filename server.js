import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { db } from "./firebase-admin.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = "bloodconnect_verify_token";
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v25.0";

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("BloodConnect WhatsApp backend is running 🚀");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified ✅");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    console.log("Webhook received:", JSON.stringify(req.body, null, 2));

    const value = req.body?.entry?.[0]?.changes?.[0]?.value;

    if (value?.statuses) {
      console.log("Status event:", value.statuses[0]?.status);
      return res.sendStatus(200);
    }

    const message = value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    if (message.type === "button") {
      const buttonPayload = message.button?.payload || "";
      const donorPhone = message.from;

      const [answer, ...requestParts] = buttonPayload.split("_");
      const requestId = requestParts.join("_");

      const donorResponse =
        answer === "YES" ? "confirmed" :
        answer === "NO" ? "declined" :
        "unknown";

      await db.collection("whatsappRequests").doc(requestId).update({
        donorResponse,
        status: "responded",
        responsePhone: donorPhone,
        responseButtonId: buttonPayload,
        respondedAt: new Date()
      });

      console.log("Updated WhatsApp request:", requestId, donorResponse);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error);
    return res.sendStatus(200);
  }
});

app.post("/send-whatsapp", async (req, res) => {
  try {
    console.log("✅ /send-whatsapp called");
    console.log("Request body:", req.body);

const {
    requestId,
    donorId,
    donorName,
    donorPhone,
    bloodGroup,
    hospitalName,
    city,
    patientContact,
    staffId,
    staffName
} = req.body;

    if (!process.env.WHATSAPP_TOKEN) {
      return res.status(500).json({
        success: false,
        message: "WHATSAPP_TOKEN missing in Render."
      });
    }

    if (!process.env.WHATSAPP_PHONE_NUMBER_ID) {
      return res.status(500).json({
        success: false,
        message: "WHATSAPP_PHONE_NUMBER_ID missing in Render."
      });
    }

    if (!donorPhone) {
      return res.status(400).json({
        success: false,
        message: "donorPhone is required."
      });
    }

    const formattedPhone = String(donorPhone).replace(/\D/g, "");

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

   const payload = {
  messaging_product: "whatsapp",
  to: formattedPhone,
  type: "template",
  template: {
    name: "blood_request_confirm",
    language: {
      code: "en_US"
    },
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: donorName || "Donor" },
          { type: "text", text: bloodGroup || "Blood" },
          { type: "text", text: hospitalName || "Hospital" },
          { type: "text", text: city || "City" },
          { type: "text", text: patientContact || "Not Provided" }
        ]
      },
      {
        type: "button",
        sub_type: "quick_reply",
        index: "0",
        parameters: [
          {
            type: "payload",
            payload: `YES_${requestId}`
          }
        ]
      },
      {
        type: "button",
        sub_type: "quick_reply",
        index: "1",
        parameters: [
          {
            type: "payload",
            payload: `NO_${requestId}`
          }
        ]
      }
    ]
  }
};

    console.log("Sending template payload:", JSON.stringify(payload, null, 2));

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    console.log("Send WhatsApp status:", response.status);
    console.log("Send WhatsApp response:", JSON.stringify(data, null, 2));

    if (!response.ok) {
      return res.status(500).json({
        success: false,
        message: "WhatsApp API error",
        error: data
      });
    }

    return res.json({
      success: true,
      message: "WhatsApp test1 template sent successfully.",
      data
    });

  } catch (error) {
    console.error("Send WhatsApp error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while sending WhatsApp message.",
      error: error.message
    });
  }
});
app.get("/subscribe-waba", async (req, res) => {
  try {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/subscribed_apps`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json();

    console.log("Subscribe WABA status:", response.status);
    console.log("Subscribe WABA response:", JSON.stringify(data, null, 2));

    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Subscribe WABA error:", error);
    return res.status(500).json({ error: error.message });
  }
});

app.post("/get-distance", async (req, res) => {
  try {
    const {
      hospitalLatitude,
      hospitalLongitude,
      donorLatitude,
      donorLongitude
    } = req.body;

    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "GOOGLE_MAPS_API_KEY missing in Render."
      });
    }

    if (
      hospitalLatitude == null ||
      hospitalLongitude == null ||
      donorLatitude == null ||
      donorLongitude == null
    ) {
      return res.status(400).json({
        success: false,
        message: "Hospital and donor coordinates are required."
      });
    }

    const origins = `${hospitalLatitude},${hospitalLongitude}`;
    const destinations = `${donorLatitude},${donorLongitude}`;

    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origins)}&destinations=${encodeURIComponent(destinations)}&mode=driving&region=in&key=${process.env.GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK") {
      return res.status(500).json({
        success: false,
        message: "Google Distance Matrix API error.",
        googleStatus: data.status,
        errorMessage: data.error_message || "",
        data
      });
    }

    const element = data.rows?.[0]?.elements?.[0];

    if (!element || element.status !== "OK") {
      return res.status(404).json({
        success: false,
        message: "Could not calculate distance.",
        elementStatus: element?.status || "NO_ELEMENT",
        data
      });
    }

    return res.json({
      success: true,
      distanceText: element.distance.text,
      durationText: element.duration.text,
      distanceKm: (element.distance.value / 1000).toFixed(1),
      durationMin: Math.round(element.duration.value / 60)
    });

  } catch (error) {
    console.error("Google distance error:", error);
    return res.status(500).json({
      success: false,
      message: "Google distance calculation failed.",
      error: error.message
    });
  }
});

app.post("/geocode-address", async (req, res) => {
  try {
    const { address } = req.body;

    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "GOOGLE_MAPS_API_KEY missing in Render."
      });
    }

    if (!address) {
      return res.status(400).json({
        success: false,
        message: "address is required."
      });
    }

    const url =
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=in&key=${process.env.GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK" || !data.results?.length) {
      return res.status(404).json({
        success: false,
        message: "Could not find coordinates.",
        googleStatus: data.status,
        errorMessage: data.error_message || "",
        data
      });
    }

    const result = data.results[0];
    const { lat, lng } = result.geometry.location;

    return res.json({
      success: true,
      latitude: lat,
      longitude: lng,
      coordinates: `${lat},${lng}`,
      formattedAddress: result.formatted_address,
      placeId: result.place_id,
      locationType: result.geometry.location_type
    });

  } catch (error) {
    console.error("Google geocode error:", error);
    return res.status(500).json({
      success: false,
      message: "Google geocoding failed.",
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
