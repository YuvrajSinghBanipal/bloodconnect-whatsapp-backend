import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = "bloodconnect_verify_token";

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("BloodConnect WhatsApp backend is running 🚀");
});

// WEBHOOK VERIFY
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

// WEBHOOK RECEIVE
app.post("/webhook", (req, res) => {
  console.log("Webhook event received:");
  console.log(JSON.stringify(req.body, null, 2));

  const value = req.body?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];

  if (message?.type === "button") {
    const buttonId = message.button.payload;
    const from = message.from;

    console.log("Donor number:", from);
    console.log("Button selected:", buttonId);

    // Later we will update Firebase here
  }

  res.sendStatus(200);
});

app.post("/send-whatsapp", async (req, res) => {
  console.log("✅ /send-whatsapp request received:");
  console.log(req.body);

  try {
    const {
      requestId,
      donorName,
      donorPhone,
      bloodGroup,
      hospitalName,
      city
    } = req.body;

    if (!process.env.WHATSAPP_TOKEN) {
      return res.status(500).json({ success: false, message: "WHATSAPP_TOKEN is missing in .env" });
    }

    if (!process.env.WHATSAPP_PHONE_NUMBER_ID) {
      return res.status(500).json({ success: false, message: "WHATSAPP_PHONE_NUMBER_ID is missing in .env" });
    }

    if (!requestId) {
      return res.status(400).json({ success: false, message: "requestId is required." });
    }

    if (!donorPhone) {
      return res.status(400).json({ success: false, message: "Donor phone is required." });
    }

    const formattedPhone = String(donorPhone).replace(/\D/g, "");

    const messageText =
      `Hello ${donorName || "Donor"},\n\n` +
      `This is BloodConnect on behalf of ${hospitalName || "the hospital"}${city ? `, ${city}` : ""}.\n\n` +
      `A patient currently requires ${bloodGroup || "blood"}, and our records show that you may be a suitable donor.\n\n` +
      `Please select one option below so the hospital team can confirm your availability.\n\n` +
      `Thank you for being a lifesaver.\n- BloodConnect`;

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

    console.log("Meta status:", response.status);
    console.log("Meta response:", JSON.stringify(data, null, 2));

    if (!response.ok) {
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
    console.error("Send WhatsApp server error:", error);

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
