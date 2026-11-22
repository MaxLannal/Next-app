// The hub's fallback calendar reader, for when macOS refuses the calendar-helper
// (as it can when the hub runs under launchd) or the helper isn't built yet.
//
//   osascript -l JavaScript calendar-jxa.js <fromISO> <toISO>
//
// Prints the same CalendarEvent[] JSON as `calendar-helper events`, read from the
// Calendar app over Apple Events. The Calendar app only returns the first
// occurrence of a repeating event here; EventKit expands every occurrence.

function run(argv) {
  const from = new Date(argv[0]);
  const to = new Date(argv[1]);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) {
    throw new Error('usage: calendar-jxa.js <fromISO> <toISO>');
  }

  const Calendar = Application('Calendar');
  const out = [];
  for (const calendar of Calendar.calendars()) {
    const found = calendar.events.whose({ _and: [{ startDate: { _lessThan: to } }, { endDate: { _greaterThan: from } }] });
    const ids = found.uid();
    if (ids.length === 0) continue;

    // One Apple Event per property for the whole calendar, not one per event.
    const titles = found.summary();
    const starts = found.startDate();
    const ends = found.endDate();
    const allDay = found.alldayEvent();
    const locations = found.location();
    const notes = found.description();
    const urls = found.url();
    const name = calendar.name();
    const color = hex(calendar.color());

    for (let i = 0; i < ids.length; i++) {
      out.push({
        id: `${ids[i]}@${Math.floor(starts[i].getTime() / 1000)}`,
        title: titles[i] || '',
        start: starts[i].toISOString(),
        end: ends[i].toISOString(),
        allDay: allDay[i] === true,
        calendar: name,
        color,
        location: locations[i] || null,
        notes: notes[i] || null,
        url: urls[i] || null,
      });
    }
  }

  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return JSON.stringify(out);
}

/** The Calendar app's RGB colour (0–65535 per channel, or 0–1) as #rrggbb. */
function hex(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return '#8c93b0';
  const scale = rgb.some((v) => v > 1) ? 65535 : 1;
  const byte = (v) => Math.round(Math.min(Math.max(v / scale, 0), 1) * 255).toString(16).padStart(2, '0');
  return `#${byte(rgb[0])}${byte(rgb[1])}${byte(rgb[2])}`;
}
