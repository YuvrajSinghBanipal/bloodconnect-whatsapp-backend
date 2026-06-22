import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { db } from "./firebase-admin.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = "bloodconnect_verify_token";

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
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (message?.type === "button") {
      const buttonId = message.button.payload;
      const donorPhone = message.from;

      const [answer, ...requestParts] = buttonId.split("_");
      const requestId = requestParts.join("_");

      let donorResponse = "unknown";

      if (answer === "YES") donorResponse = "confirmed";
      if (answer === "NO") donorResponse = "declined";

      await db.collection("whatsappRequests").doc(requestId).update({
        donorResponse,
        status: "responded",
        responsePhone: donorPhone,
        responseButtonId: buttonId,
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
    const {
      requestId,
      donorName,
      donorPhone,
      bloodGroup,
      hospitalName,
      city
    } = req.body;

    const formattedPhone = String(donorPhone).replace(/\D/g, "");

    const messageText =
      `Hello ${donorName || "Donor"},\n\n` +
      `This is BloodConnect on behalf of ${hospitalName || "the hospital"}${city ? `, ${city}` : ""}.\n\n` +
      `A patient currently requires ${bloodGroup || "blood"}.\n\n` +
      `Please select one option below so the hospital team can confirm your availability.\n\n` +
      `- BloodConnect`;

    const url = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: formattedPhone,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: messageText },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: `YES_${requestId}`,
                title: "Yes, I can"
              }
            },
            {
              type: "reply",
              reply: {
                id: `NO_${requestId}`,
                title: "No, I can't"
              }
            }
          ]
        }
      }
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.log("Meta error:", JSON.stringify(data, null, 2));
      return res.status(500).json({
        success: false,
        message: "WhatsApp API error",
        error: data
      });
    }

    return res.json({
      success: true,
      message: "WhatsApp message sent successfully.",
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
