import { createClientFromRequest } from "npm:@base44/sdk";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const update = await req.json();

    const message = update.message;
    if (!message) {
      return Response.json({ ok: true });
    }

    // Accept text messages, photos (with or without caption), and documents (images)
    const hasText = !!message.text;
    const hasPhoto = !!message.photo;
    const hasDocument = message.document?.mime_type?.startsWith("image/");

    if (!hasText && !hasPhoto && !hasDocument) {
      return Response.json({ ok: true });
    }

    const chatId = String(message.chat.id);
    let userText = message.text || message.caption || "";
    const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

    if (!TELEGRAM_TOKEN) {
      console.error("TELEGRAM_BOT_TOKEN not configured");
      return Response.json({ error: "Bot token not configured" }, { status: 500 });
    }

    // Handle /start command
    if (userText === "/start") {
      await sendTelegramMessage(
        TELEGRAM_TOKEN,
        chatId,
        "Hi! I'm your calendar assistant.\n\nSend me event information — invitations, save the dates, or just describe an event — and I'll add it to your Google Calendar.\n\nYou can send text, forward messages, or even send photos of invitations!"
      );
      return Response.json({ ok: true });
    }

    // If there's a photo or image document, download from Telegram and upload to Base44
    let imageFileUrl: string | null = null;
    let extractedImageText: string | null = null;

    if (hasPhoto || hasDocument) {
      // Let user know we're processing
      await sendTelegramMessage(TELEGRAM_TOKEN, chatId, "Processing your image...");

      const fileId = hasPhoto
        ? message.photo[message.photo.length - 1].file_id
        : message.document.file_id;

      try {
        // Step 1: Get the file path from Telegram
        const fileInfoRes = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`
        );
        const fileInfo = await fileInfoRes.json();
        const filePath = fileInfo.result?.file_path;

        if (filePath) {
          // Step 2: Download the image
          const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
          const imageRes = await fetch(downloadUrl);

          if (imageRes.ok) {
            const imageBlob = await imageRes.blob();
            const ext = filePath.split(".").pop() || "jpg";
            const mimeType = imageBlob.type || (ext === "png" ? "image/png" : "image/jpeg");
            const file = new File([imageBlob], `telegram_image.${ext}`, { type: mimeType });

            // Step 3: Upload to Base44
            const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });
            imageFileUrl = uploadResult.file_url;

            // Step 4: Extract text/data from image using AI vision
            const extracted: any = await base44.asServiceRole.integrations.Core.ExtractDataFromUploadedFile({
              file_url: imageFileUrl,
              json_schema: {
                type: "object",
                properties: {
                  event_name: { type: "string", description: "Name or title of the event" },
                  date: { type: "string", description: "Date of the event" },
                  time: { type: "string", description: "Time of the event" },
                  end_time: { type: "string", description: "End time if visible" },
                  location: { type: "string", description: "Location or venue" },
                  description: { type: "string", description: "Any other details about the event" },
                  all_text: { type: "string", description: "All text visible in the image" },
                },
              },
            });
            // Unwrap the output if nested in {status, output} wrapper
            const outputData = extracted?.output || extracted;
            extractedImageText = JSON.stringify(outputData);
          }
        }
      } catch (e) {
        console.error("Image processing error:", e);
        // Continue without image — don't block the whole flow
      }

      if (!userText) {
        userText = extractedImageText
          ? `[User sent an image. Extracted content: ${extractedImageText}]`
          : "[User sent an image but it could not be processed]";
      } else if (extractedImageText) {
        userText = `${userText}\n[Image content: ${extractedImageText}]`;
      }
    }

    // Look up or create chat record for conversation state
    const chatRecords = await base44.asServiceRole.entities.TelegramChat.filter({ chat_id: chatId });
    let chatRecord: any;

    if (chatRecords.length === 0) {
      chatRecord = await base44.asServiceRole.entities.TelegramChat.create({
        chat_id: chatId,
        messages: [],
        status: "idle",
      });
    } else {
      chatRecord = chatRecords[0];
    }

    // Build conversation history
    const conversationHistory: Array<{ role: string; content: string }> = chatRecord.messages || [];
    conversationHistory.push({ role: "user", content: userText });

    // Keep last 10 messages for context
    const recentMessages = conversationHistory.slice(-10);

    // Build a precise date reference with day of week
    const now = new Date();
    // Adjust to Israel time (UTC+2 / UTC+3 depending on DST)
    const israelOffset = 2 * 60; // minutes (winter time)
    const israelTime = new Date(now.getTime() + (israelOffset + now.getTimezoneOffset()) * 60000);
    const dayName = DAYS[israelTime.getDay()];
    const todayStr = israelTime.toISOString().split("T")[0];
    const timeStr = israelTime.toISOString().split("T")[1].substring(0, 5);

    // Build LLM params
    const llmParams: any = {
      prompt: `You are a bilingual (English/Hebrew) family calendar assistant that helps manage schedules, homework, activities, appointments, and events.

## Core Capabilities
- Add events: Create homework assignments, activities, appointments, and family events
- Update/delete events when asked
- Answer queries about upcoming schedules

## Language Handling
- Auto-detect: Seamlessly work with English, Hebrew, or mixed-language input
- Preserve original: Keep event titles in the language provided
- Respond in the same language as the user's request
- Recognize Hebrew calendar terms (לו״ז, שיעורי בית, פגישה, יומולדת, חופשה)

## Input Processing
The user sends text messages or images containing event information:
- Invitations, save-the-dates, flyers, event announcements
- Homework assignments, school notices, schedule screenshots
- WhatsApp message screenshots, handwritten notes
- Direct text descriptions of events

${extractedImageText ? `## Image Data
The user sent an image. Here is the structured data extracted from it:
${extractedImageText}

Use this extracted data to identify event details. If the image contained multiple events, process all of them. Summarize what you found and confirm before adding.` : ""}

## Your Job
1. Extract event details: title, start date/time, end date/time, location, description
2. If you have enough info to create an event (at minimum: title and start date/time), set action to "create_event"
3. If critical information is missing or ambiguous, set action to "ask_clarification" and ask specifically what you need
4. For non-event messages, set action to "chat"
5. When processing image data, acknowledge what you found ("I can see a wedding invitation for...")

## CURRENT DATE AND TIME (Israel timezone)
- Today is ${dayName}, ${todayStr} (current time: ${timeStr})
- This week: Mon=${getDateForDay(israelTime, 1)}, Tue=${getDateForDay(israelTime, 2)}, Wed=${getDateForDay(israelTime, 3)}, Thu=${getDateForDay(israelTime, 4)}, Fri=${getDateForDay(israelTime, 5)}, Sat=${getDateForDay(israelTime, 6)}, Sun=${getDateForDay(israelTime, 0)}

## Date & Time Rules
- Use ISO 8601 format: YYYY-MM-DDTHH:mm:ss
- Accept dates in multiple formats: 15/2, Feb 15, tomorrow, מחר, בעוד שבוע
- "Monday" = NEXT upcoming Monday; "next Monday" = the Monday AFTER that
- If year not specified, assume next upcoming occurrence
- Time inference:
  - Homework/assignments: due by end of day (23:59) unless specified
  - Appointments: ask for specific time if not given
  - Birthdays/holidays/vacations: all-day events (use 00:00-23:59)
  - Activities: use provided time, default 1 hour duration
- Duration defaults: 1 hour for appointments, 30 min for homework sessions

## Smart Defaults
- Infer event type: "math test" = exam, "dentist" = appointment, "football" = activity
- Detect recurring patterns: "every week", "weekly", "כל יום שלישי"
- Track family members when mentioned
- Don't ask for clarification if you can reasonably infer details

## Response Style
- Confirm actions: "✅ Added: Math homework due tomorrow at 11:59 PM"
- Be concise, friendly, occasional emojis (📅 🎯 ✏️ ⚽ 🎉 ⏰ 📸)
- Warn about conflicts: "⚠️ This overlaps with soccer practice at 4 PM"
- For images: acknowledge what you found before adding

Conversation so far:
${recentMessages.map((m) => `${m.role}: ${m.content}`).join("\n")}`,
      response_json_schema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["create_event", "ask_clarification", "chat"],
            description: "What action to take",
          },
          message: {
            type: "string",
            description: "Response message to send to the user",
          },
          event: {
            type: "object",
            description: "Event details (only when action is create_event)",
            properties: {
              title: { type: "string", description: "Event title" },
              start_datetime: { type: "string", description: "ISO 8601 start datetime" },
              end_datetime: { type: "string", description: "ISO 8601 end datetime" },
              location: { type: "string", description: "Event location (optional)" },
              description: { type: "string", description: "Event description (optional)" },
            },
          },
        },
        required: ["action", "message"],
      },
    };

    // Call LLM to parse event info and decide action
    const llmResponse = (await base44.asServiceRole.integrations.Core.InvokeLLM(llmParams)) as {
      action: string;
      message: string;
      event?: {
        title: string;
        start_datetime: string;
        end_datetime?: string;
        location?: string;
        description?: string;
      };
    };

    let responseMessage = llmResponse.message;

    // If LLM says create event, call the Google Calendar API
    if (llmResponse.action === "create_event" && llmResponse.event) {
      try {
        const token = await base44.asServiceRole.connectors.getAccessToken("googlecalendar");
        const calendarId = Deno.env.get("GOOGLE_CALENDAR_ID") || "primary";
        const timezone = Deno.env.get("TIMEZONE") || "Asia/Jerusalem";

        const endDt =
          llmResponse.event.end_datetime ||
          new Date(new Date(llmResponse.event.start_datetime).getTime() + 60 * 60 * 1000).toISOString();

        const calendarEvent: Record<string, any> = {
          summary: llmResponse.event.title,
          start: { dateTime: llmResponse.event.start_datetime, timeZone: timezone },
          end: { dateTime: endDt, timeZone: timezone },
        };

        if (llmResponse.event.location) calendarEvent.location = llmResponse.event.location;
        if (llmResponse.event.description) calendarEvent.description = llmResponse.event.description;

        const calResponse = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(calendarEvent),
          }
        );

        if (calResponse.ok) {
          const created = await calResponse.json();
          const link = created.htmlLink || "";
          responseMessage = link
            ? `${responseMessage}\n\n📅 Event created!\n${link}`
            : `${responseMessage}\n\n📅 Event created!`;
        } else {
          const errText = await calResponse.text();
          console.error("Calendar API error:", errText);
          responseMessage = `I understood the event details but couldn't create it in Google Calendar. Error: ${errText}`;
        }
      } catch (e) {
        console.error("Calendar creation error:", e);
        responseMessage = `I understood the event but hit an error creating it: ${e.message}`;
      }
    }

    // Send response back to Telegram
    await sendTelegramMessage(TELEGRAM_TOKEN, chatId, responseMessage);

    // Update conversation history
    recentMessages.push({ role: "assistant", content: responseMessage });
    await base44.asServiceRole.entities.TelegramChat.update(chatRecord.id, {
      messages: recentMessages.slice(-10),
      status: llmResponse.action === "ask_clarification" ? "awaiting_clarification" : "idle",
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/** Get the date string (YYYY-MM-DD) for a given day of the week relative to today */
function getDateForDay(today: Date, targetDay: number): string {
  const currentDay = today.getDay();
  let diff = targetDay - currentDay;
  if (diff <= 0) diff += 7; // always get next occurrence
  const target = new Date(today);
  target.setDate(today.getDate() + diff);
  return target.toISOString().split("T")[0];
}

async function sendTelegramMessage(token: string, chatId: string, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Telegram send error:", err);
  }
}
