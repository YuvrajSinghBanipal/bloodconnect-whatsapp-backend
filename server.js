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
      console.log("Message status event:", JSON.stringify(value.statuses, null, 2));
      return res.sendStatus(200);
    }

    const message = value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const donorPhone = message.from;
    let buttonId = "";
    let buttonText = "";

    if (message.type === "button") {
      buttonId = message.button?.payload || "";
      buttonText = message.button?.text || "";
    }

    if (message.type === "interactive") {
      buttonId = message.interactive?.button_reply?.id || "";
      buttonText = message.interactive?.button_reply?.title || "";
    }

    const rawReply = (buttonId || buttonText || "").trim();
    console.log("Button reply detected:", rawReply);

    if (!rawReply) return res.sendStatus(200);

    let answer = "";
    let requestId = "";

    if (rawReply.includes("_")) {
      const parts = rawReply.split("_");
      answer = parts[0].toUpperCase();
      requestId = parts.slice(1).join("_");
    } else {
      const lower = rawReply.toLowerCase();
      if (lower === "yes") answer = "YES";
      if (lower === "no") answer = "NO";
    }

    let donorResponse = "unknown";
    if (answer === "YES") donorResponse = "confirmed";
    if (answer === "NO") donorResponse = "declined";

    if (!requestId) {
      console.log("No requestId in button. Searching latest pending request for:", donorPhone);

      const snap = await db
        .collection("whatsappRequests")
        .where("donorPhone", "==", donorPhone)
        .where("status", "==", "pending")
        .get();

      if (snap.empty) {
        console.log("No pending request found for:", donorPhone);
        return res.sendStatus(200);
      }

      let latestDoc = snap.docs[0];

      snap.docs.forEach((d) => {
        const a = d.data().createdAt?.toMillis?.() || 0;
        const b = latestDoc.data().createdAt?.toMillis?.() || 0;
        if (a > b) latestDoc = d;
      });

      requestId = latestDoc.id;
    }

    await db.collection("whatsappRequests").doc(requestId).update({
      donorResponse,
      status: "responded",
      responsePhone: donorPhone,
      responseButtonId: rawReply,
      respondedAt: new Date()
    });

    console.log("Updated WhatsApp request:", requestId, donorResponse);

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
  donorPhone,
  donorName,
  bloodGroup,
  hospitalName,
  city
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
          { type: "text", text: city || "City" }
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
      message: "WhatsApp hello_world template sent successfully.",
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
