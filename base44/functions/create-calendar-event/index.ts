import { createClientFromRequest } from "npm:@base44/sdk";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { title, start_datetime, end_datetime, location, description, timezone } = await req.json();

    if (!title || !start_datetime) {
      return Response.json(
        { error: "title and start_datetime are required" },
        { status: 400 }
      );
    }

    const tz = timezone || Deno.env.get("TIMEZONE") || "Asia/Jerusalem";

    // Default end time to 1 hour after start if not provided
    const endDt = end_datetime || new Date(new Date(start_datetime).getTime() + 60 * 60 * 1000).toISOString();

    const token = await base44.asServiceRole.connectors.getAccessToken("googlecalendar");
    const calendarId = Deno.env.get("GOOGLE_CALENDAR_ID") || "primary";

    const calendarEvent: Record<string, any> = {
      summary: title,
      start: { dateTime: start_datetime, timeZone: tz },
      end: { dateTime: endDt, timeZone: tz },
    };

    if (location) calendarEvent.location = location;
    if (description) calendarEvent.description = description;

    const response = await fetch(
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

    if (!response.ok) {
      const errorText = await response.text();
      return Response.json(
        { error: `Google Calendar API error: ${errorText}` },
        { status: response.status }
      );
    }

    const created = await response.json();

    return Response.json({
      success: true,
      event_id: created.id,
      html_link: created.htmlLink,
      summary: created.summary,
      start: created.start,
      end: created.end,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
